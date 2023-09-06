import ExpoModulesCore
import CryptoKit

// TODO: doc comments
public class ExpoEnclaveModule: Module {
  internal static func shouldUseSecureEnclave() -> Bool {
    return TARGET_OS_SIMULATOR == 0 && SecureEnclave.isAvailable
  }

  var keyManager: KeyManager = shouldUseSecureEnclave() ? SecureEnclaveKeyManager() : FallbackKeyManager()

  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  public func definition() -> ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('ExpoEnclave')` in JavaScript.
    Name("ExpoEnclave")

    AsyncFunction("getHardwareSecurityLevel") { () -> String in
      if (keyManager is SecureEnclaveKeyManager) {
        return HardwareSecurityLevel.HARDWARE_ENCLAVE.rawValue
      } else {
        return HardwareSecurityLevel.SOFTWARE.rawValue
      }
    }

    AsyncFunction("getBiometricSecurityLevel") { () -> String in
      if (keyManager is SecureEnclaveKeyManager) {
        return BiometricSecurityLevel.AVAILABLE.rawValue
      } else {
        return BiometricSecurityLevel.NONE.rawValue
      }
    }

    AsyncFunction("forceFallbackUsage") { () in
      keyManager = FallbackKeyManager()
    }

    AsyncFunction("fetchPublicKey") { (accountName: String) throws -> String? in
      return try self.keyManager.fetchPublicKey(accountName: accountName)
    }

    AsyncFunction("createKeyPair") { (accountName: String) throws -> String in
      return try self.keyManager.createKeyPair(accountName: accountName)
    }

    AsyncFunction("deleteKeyPair") { (accountName: String) throws in
      return try self.keyManager.deleteKeyPair(accountName: accountName)
    }

    AsyncFunction("sign") { (accountName: String, hexMessage: String, biometricPromptCopy: BiometricPromptCopy) throws -> String in
      return try self.keyManager.sign(accountName: accountName, hexMessage: hexMessage, usageMessage: biometricPromptCopy.usageMessage)
    }

    AsyncFunction("verify") { (accountName: String, hexSignature: String, hexMessage: String) throws -> Bool in
      return try self.keyManager.verify(accountName: accountName, hexSignature: hexSignature, hexMessage: hexMessage)
    }
  }
}

enum HardwareSecurityLevel: String, Enumerable {
  case SOFTWARE
  case TRUSTED_ENVIRONMENT
  case HARDWARE_ENCLAVE
}

enum BiometricSecurityLevel: String, Enumerable {
  case NONE
  case AVAILABLE
}

internal struct BiometricPromptCopy: Record {
  @Field
  var usageMessage: String

  @Field
  var androidTitle: String
}