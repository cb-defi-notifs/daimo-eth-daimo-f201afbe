package expo.modules.enclave

import android.app.KeyguardManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.spec.ECGenParameterSpec
import java.security.KeyPairGenerator
import java.security.KeyPair
import java.security.KeyStore
import java.security.KeyStoreException
import java.security.Signature
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import java.util.concurrent.Executor
import androidx.fragment.app.FragmentActivity
import android.content.Context
import android.content.Intent
import expo.modules.core.ModuleRegistry
import expo.modules.core.interfaces.ActivityEventListener
import expo.modules.core.interfaces.ActivityProvider
import android.app.Activity
import expo.modules.core.interfaces.services.UIManager
import expo.modules.core.Promise
import android.os.Build
import android.content.pm.PackageManager
import expo.modules.core.arguments.ReadableArguments

class FallbackKeyManager(_context: Context, _moduleRegistry: ModuleRegistry): KeyManager, ActivityEventListener {
  private val context = _context
  private val moduleRegistry = _moduleRegistry
  private val uiManager = moduleRegistry.getModule(UIManager::class.java)
  private val DEVICE_CREDENTIAL_FALLBACK_CODE = 1001

  private var pendingSignPromise: Promise? = null
  private var pendingSignAccountName: String? = null
  private var pendingSignHexMessage: String? = null

  init {
    uiManager.registerActivityEventListener(this)
  }

  internal fun getCurrentActivity(): Activity? {
    val activityProvider: ActivityProvider = moduleRegistry.getModule(ActivityProvider::class.java)
    return activityProvider.currentActivity
  }

  internal fun createSigningPrivkey(accountName: String) {
    var params = KeyGenParameterSpec.Builder(accountName, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .build()

    var keyPairGenerator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER)
    keyPairGenerator.initialize(params)
    keyPairGenerator.generateKeyPair()
  }

  internal fun getSigningPrivkey(accountName: String): KeyPair? {
    val ks: KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    if (!ks.containsAlias(accountName)) {
      return null
    }
    val entry = ks.getEntry(accountName, null)
    if (entry !is KeyStore.PrivateKeyEntry) {
        throw KeyStoreException("Bad format for account private key")
    }
    return KeyPair(entry.certificate.publicKey, entry.privateKey)
  }

  override fun fetchPublicKey(accountName: String): String? {
    return getSigningPrivkey(accountName)?.public?.encoded?.toHexString()
  }

  override fun createKeyPair(accountName: String): String {
    createSigningPrivkey(accountName)
    return fetchPublicKey(accountName)!!
  }

  override fun deleteKeyPair(accountName: String) {
    val ks: KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    ks.deleteEntry(accountName)
  }

  override fun sign(accountName: String, hexMessage: String, promptCopy: ReadableArguments, promise: Promise) {
    val fragmentActivity = getCurrentActivity() as FragmentActivity?
    val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val intent = keyguardManager.createConfirmDeviceCredentialIntent(
      promptCopy.getString("androidTitle"),
      promptCopy.getString("usageMessage"))

    if (intent == null) {
      promise.reject("ERR_AUTH_FAILED", "Authentication failed")
    }

    pendingSignPromise = promise
    pendingSignAccountName = accountName
    pendingSignHexMessage = hexMessage

    uiManager.runOnUiQueueThread {
      fragmentActivity!!.startActivityForResult(intent, DEVICE_CREDENTIAL_FALLBACK_CODE)
    }
  }

  override fun verify(accountName: String, hexSignature: String, hexMessage: String): Boolean {
    val publicKey = getSigningPrivkey(accountName)!!.public
    val verified = Signature.getInstance("SHA256withECDSA").run {
      initVerify(publicKey)
      update(hexMessage.decodeHex())
      verify(hexSignature.decodeHex())
    }
    return verified
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == DEVICE_CREDENTIAL_FALLBACK_CODE) {
      if (resultCode == Activity.RESULT_OK) {
        val privateKey = getSigningPrivkey(pendingSignAccountName!!)!!.private
        val signature = Signature.getInstance("SHA256withECDSA").run {
          initSign(privateKey)
          update(pendingSignHexMessage!!.decodeHex())
          sign()
        }
        pendingSignAccountName = null
        pendingSignHexMessage = null
        pendingSignPromise!!.resolve(signature.toHexString())
      } else {
        pendingSignAccountName = null
        pendingSignHexMessage = null
        pendingSignPromise!!.reject("ERR_AUTH_FAILED", "Authentication failed")
      }
    }
  }

  override fun onNewIntent(intent: Intent) = Unit
}