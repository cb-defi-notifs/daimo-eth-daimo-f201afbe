import { assertNotNull } from "@daimo/common";
import { DaimoChain } from "@daimo/contract";
import Octicons from "@expo/vector-icons/Octicons";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CreateAccountPage } from "./CreateAccountPage";
import { OnboardingHeader } from "./OnboardingHeader";
import { UseExistingPage } from "./UseExistingPage";
import { ActStatus } from "../../../action/actStatus";
import { useCreateAccount } from "../../../action/useCreateAccount";
import { env } from "../../../logic/env";
import { requestEnclaveSignature } from "../../../logic/key";
import { NamedError } from "../../../logic/log";
import { getPushNotificationManager } from "../../../logic/notify";
import { defaultEnclaveKeyName } from "../../../model/account";
import { ButtonBig, TextButton } from "../../shared/Button";
import { InfoLink } from "../../shared/InfoLink";
import { InputBig, OctName } from "../../shared/InputBig";
import Spacer from "../../shared/Spacer";
import { color, ss } from "../../shared/style";
import {
  EmojiToOcticon,
  TextBody,
  TextCenter,
  TextError,
  TextH1,
  TextLight,
} from "../../shared/text";

type OnboardPage =
  | "intro"
  | "flow-selection"
  | "create-invite"
  | "create-try-enclave"
  | "existing-try-enclave"
  | "create"
  | "existing"
  | "new-allow-notifications"
  | "existing-allow-notifications"
  | "new-loading";

export default function OnboardingScreen({
  onOnboardingComplete,
}: {
  onOnboardingComplete: () => void;
}) {
  // Navigation with a back button
  // TODO: consider splitting into components and just using StackNavigation
  const [page, setPage] = useState<OnboardPage>("intro");
  const pageStack = useRef([] as OnboardPage[]).current;
  const goTo = (newPage: OnboardPage) => {
    pageStack.push(page);
    setPage(newPage);
  };
  const goToPrev = () => pageStack.length > 0 && setPage(pageStack.pop()!);
  const [daimoChain, setDaimoChain] = useState<DaimoChain>("base");

  const next = getNext(page, goTo, setDaimoChain, onOnboardingComplete);
  const prev = pageStack.length === 0 ? undefined : goToPrev;
  // User enters their name
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  console.log(`[ONBOARDING] chainId ${daimoChain}`);

  // Create an account as soon as possible, hiding latency
  const {
    exec: createExec,
    reset: createReset,
    status: createStatus,
    message: createMessage,
  } = useCreateAccount(name, inviteCode, daimoChain);

  const reset = () => {
    pageStack.length = 0;
    goTo("flow-selection");
    setName("");
    setInviteCode("");
    createReset && createReset();
  };

  return (
    <View style={styles.onboardingScreen}>
      {page === "intro" && <IntroPages onNext={next} />}
      {page === "flow-selection" && <FlowSelectionPage onNext={next} />}
      {page === "create-invite" && (
        <InvitePage
          onNext={next}
          onPrev={prev}
          daimoChain={daimoChain}
          inviteCode={inviteCode}
          setInviteCode={setInviteCode}
        />
      )}
      {(page === "create-try-enclave" || page === "existing-try-enclave") && (
        <SetupKeyPage onNext={next} onPrev={prev} createStatus={createStatus} />
      )}
      {page === "create" && (
        <CreateAccountPage
          onNext={next}
          onPrev={prev}
          name={name}
          setName={setName}
          daimoChain={daimoChain}
          exec={createExec}
          status={createStatus}
          message={createMessage}
        />
      )}
      {page === "existing" && (
        <UseExistingPage onNext={next} onPrev={prev} daimoChain={daimoChain} />
      )}
      {page === "new-allow-notifications" && (
        <AllowNotificationsPage onNext={next} />
      )}
      {page === "existing-allow-notifications" && (
        <AllowNotificationsPage onNext={next} />
      )}
      {page === "new-loading" && (
        <CreateAccountSpinnerPage
          loadingStatus={createStatus}
          loadingMessage={createMessage}
          onNext={next}
          onRetry={reset}
        />
      )}
    </View>
  );
}

function getNext(
  page: OnboardPage,
  goToPage: (p: OnboardPage) => void,
  setDaimoChain: (daimoChain: DaimoChain) => void,
  onOnboardingComplete: () => void
): ({
  choice,
  isTestnet,
}?: {
  choice?: "create" | "existing";
  isTestnet?: boolean;
}) => void {
  const fnGoTo = (p: OnboardPage) => () => goToPage(p);
  switch (page) {
    case "intro":
      return fnGoTo("flow-selection");
    case "flow-selection":
      return (input) => {
        const { choice } = assertNotNull(input);
        // Android goes through an extra onboarding step
        if (choice === "create") goToPage("create-invite");
        else {
          // Use existing
          if (Platform.OS !== "android") goToPage("existing");
          else goToPage("existing-try-enclave");
        }
      };
    case "create-invite":
      return (input) => {
        const { isTestnet } = assertNotNull(input);
        setDaimoChain(assertNotNull(isTestnet) ? "baseGoerli" : "base");

        if (Platform.OS !== "android") goToPage("create");
        else goToPage("create-try-enclave");
      };
    case "create-try-enclave":
      return fnGoTo("create");
    case "existing-try-enclave":
      return fnGoTo("existing");
    case "create":
      return fnGoTo("new-allow-notifications");
    case "existing":
      return fnGoTo("existing-allow-notifications");
    case "new-allow-notifications":
      return fnGoTo("new-loading");
    case "existing-allow-notifications":
    case "new-loading":
      return onOnboardingComplete;
    default:
      throw new Error(`unreachable ${page}`);
  }
}

const tokenSymbol = "USDC";
const introPages = [
  <IntroPage title="Welcome to Daimo">
    <TextParagraph>
      Daimo is a global payments app that runs on Ethereum. Send and receive
      USDC on Base mainnet.
    </TextParagraph>
  </IntroPage>,
  <IntroPage title={tokenSymbol}>
    <TextParagraph>
      You can send and receive money using the {tokenSymbol} stablecoin. 1{" "}
      {tokenSymbol} is $1.
    </TextParagraph>
    <View style={ss.container.marginHNeg16}>
      <InfoLink
        url="https://www.circle.com/en/usdc"
        title="Learn how it works here"
      />
    </View>
  </IntroPage>,
  <IntroPage title="Yours alone">
    <TextParagraph>
      Daimo stores money via cryptographic secrets. There's no bank.
    </TextParagraph>
  </IntroPage>,
  <IntroPage title="On Ethereum">
    <TextParagraph>
      Daimo runs on Base, an Ethereum rollup. This lets you send money securely,
      anywhere in the world.
    </TextParagraph>
  </IntroPage>,
];

function IntroPages({ onNext }: { onNext: () => void }) {
  const [pageIndex, setPageIndex] = useState(0);
  const updatePageBubble = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    const page = Math.round(contentOffset.x / layoutMeasurement.width);
    setPageIndex(page);
  };

  return (
    <View style={styles.introPages}>
      <PageBubble count={4} index={pageIndex} />
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.introPageScroll}
        onScroll={updatePageBubble}
        scrollEventThrottle={32}
        contentContainerStyle={{ width: `${introPages.length * 100}%` }}
      >
        {introPages.map((page, i) => (
          <View style={{ width: `${100 / introPages.length}%` }} key={i}>
            {page}
          </View>
        ))}
      </ScrollView>
      <Spacer h={32} />
      <View style={styles.introButtonsCenter}>
        <View style={styles.introButtonsWrap}>
          <ButtonBig type="primary" title="Enter" onPress={onNext} />
        </View>
      </View>
    </View>
  );
}

function TextParagraph({ children }: { children: ReactNode }) {
  const style = useRef([styles.introText, { color: color.grayDark }]).current;
  return <Text style={style}>{children}</Text>;
}

function IntroPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.introPage}>
      <TextCenter>
        <TextH1>{title}</TextH1>
      </TextCenter>
      <Spacer h={32} />
      {children}
    </View>
  );
}

function PageBubble({ count, index }: { count: number; index: number }) {
  const bubbles = [];
  for (let i = 0; i < count; i++) {
    bubbles.push(
      <View
        key={i}
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: i === index ? color.midnight : color.grayLight,
          margin: 4,
        }}
      />
    );
  }
  return (
    <View style={{ flexDirection: "row", justifyContent: "center" }}>
      {bubbles}
    </View>
  );
}

function InvitePage({
  onNext,
  onPrev,
  daimoChain,
  inviteCode,
  setInviteCode,
}: {
  onNext: ({ isTestnet }: { isTestnet: boolean }) => void;
  onPrev?: () => void;
  daimoChain: DaimoChain;
  inviteCode: string;
  setInviteCode: (inviteCode: string) => void;
}) {
  const onChange = (text: string) => setInviteCode(text.toLowerCase());

  // We haven't picked a daimoChain yet so this defaults to prod.
  const rpcHook = env(daimoChain).rpcHook;
  const result = rpcHook.verifyInviteCode.useQuery({ inviteCode });

  const isTestnet = inviteCode === "testnet";
  const isValid = isTestnet || (result.isSuccess && result.data);

  const oct = (name: OctName, color?: string) => (
    <Octicons {...{ name, color }} size={14} />
  );
  const status = (function () {
    if (!inviteCode) {
      return " ";
    } else if (result.isLoading) {
      return "...";
    } else if (isTestnet || (result.isSuccess && result.data)) {
      return <>{oct("check-circle", color.successDark)} valid invite</>;
    } else if (result.isSuccess && !result.data) {
      return <>{oct("alert")} invalid invite</>;
    } else if (result.error) {
      return <>{oct("alert")} offline?</>;
    }
    throw new Error("unreachable");
  })();

  const linkToWaitlist = () => {
    const url = `https://daimo.com/waitlist`;
    Linking.openURL(url);
  };

  return (
    <View>
      <OnboardingHeader title="Invite" onPrev={onPrev} />
      <View style={styles.paddedPage}>
        <View style={{ flexDirection: "row", justifyContent: "center" }}>
          <Octicons name="mail" size={40} color={color.midnight} />
        </View>
        <Spacer h={32} />
        <TextCenter>
          <TextParagraph>
            Daimo is currently invite-only. If you have an invite code, enter it
            below. Otherwise, you can join the waitlist.
          </TextParagraph>
        </TextCenter>
        <Spacer h={16} />
        <TextCenter>
          <TextLight>{status}</TextLight>
        </TextCenter>
        <Spacer h={16} />
        <InputBig
          placeholder="enter invite code"
          value={inviteCode}
          onChange={onChange}
          center
        />
        <Spacer h={16} />
        <ButtonBig
          type="primary"
          title="Submit"
          onPress={() => onNext({ isTestnet })}
          disabled={!isValid}
        />
        <Spacer h={16} />
        <TextButton title="Join waitlist" onPress={linkToWaitlist} />
      </View>
    </View>
  );
}

function FlowSelectionPage({
  onNext,
}: {
  onNext: ({ choice }: { choice: "create" | "existing" }) => void;
}) {
  return (
    <View style={styles.paddedPage}>
      <Spacer h={32} />
      <TextCenter>
        <TextH1>Welcome</TextH1>
      </TextCenter>
      <Spacer h={64} />
      <TextCenter>
        <TextParagraph>
          You can create a new account, or add this device to a Daimo account
          you already have.
        </TextParagraph>
      </TextCenter>
      <Spacer h={32} />
      <ButtonBig
        type="primary"
        title="Create Account"
        onPress={() => {
          onNext({ choice: "create" });
        }}
      />
      <Spacer h={16} />
      <ButtonBig
        type="subtle"
        title="Already have an account?"
        onPress={() => {
          onNext({ choice: "existing" });
        }}
      />
    </View>
  );
}

function SetupKeyPage({
  onNext,
  onPrev,
  createStatus,
}: {
  onNext: () => void;
  onPrev?: () => void;
  createStatus: ActStatus;
}) {
  const [loading, setLoading] = useState(false);
  const [askToSetPin, setAskToSetPin] = useState(false);
  const [error, setError] = useState("");

  const trySignatureGeneration = async () => {
    setLoading(true);
    try {
      await requestEnclaveSignature(
        defaultEnclaveKeyName,
        "dead",
        "Create account"
      );

      console.log(`[ONBOARDING] enclave signature trial success`);
      onNext();
    } catch (e: any) {
      console.error(e);
      if (e instanceof NamedError && e.name === "ExpoEnclaveSign") {
        setError(e.message);
      } else {
        setError("Unknown error");
      }

      // Auth failed. Possible user doesn't have proper auth set up.
      // TODO: In future, catch different errors differently.
      setAskToSetPin(true);
    }
    setLoading(false);
  };

  return (
    <View>
      <OnboardingHeader title="Set up device" onPrev={onPrev} />
      <View style={styles.paddedPage}>
        <View style={{ flexDirection: "row", justifyContent: "center" }}>
          <Octicons
            name={askToSetPin ? "unlock" : "lock"}
            size={40}
            color={color.midnight}
          />
        </View>
        <Spacer h={32} />
        <View style={ss.container.padH16}>
          <TextCenter>
            {!askToSetPin && (
              <TextBody>
                Generate your Daimo account. Your account is stored on your
                device, secured by cryptography.
              </TextBody>
            )}
            {askToSetPin && (
              <TextBody>
                Authentication failed. Does your phone have a secure lock screen
                set up? You'll need one to secure your Daimo account.
              </TextBody>
            )}
          </TextCenter>
        </View>
        <Spacer h={32} />
        {(loading || createStatus === "loading") && (
          <ActivityIndicator size="large" />
        )}
        {!loading && createStatus !== "loading" && (
          <ButtonBig
            type="primary"
            title={askToSetPin ? "Try again" : "Generate"}
            onPress={trySignatureGeneration}
          />
        )}
        {error && (
          <>
            <Spacer h={16} />
            <TextCenter>
              <TextError>{error}</TextError>
            </TextCenter>
          </>
        )}
      </View>
    </View>
  );
}

function AllowNotificationsPage({ onNext }: { onNext: () => void }) {
  const requestPermission = async () => {
    if (!Device.isDevice) {
      window.alert("Push notifications unsupported in simulator.");
      return;
    }

    const status = await Notifications.requestPermissionsAsync();
    console.log(`[ONBOARDING] notifications request ${status.status}`);
    if (!status.granted) return;

    getPushNotificationManager().maybeSavePushTokenForAccount();

    onNext();
  };

  return (
    <View style={styles.paddedPage}>
      <TextCenter>
        <Octicons name="bell" size={32} />
      </TextCenter>
      <Spacer h={32} />
      <TextCenter>
        <TextParagraph>
          You'll be notified only for account activity. For example, when you
          receive money.
        </TextParagraph>
      </TextCenter>
      <Spacer h={32} />
      <ButtonBig
        type="primary"
        title="Allow Notifications"
        onPress={requestPermission}
      />
      <Spacer h={16} />
      <ButtonBig type="subtle" title="Skip" onPress={onNext} />
    </View>
  );
}

function CreateAccountSpinnerPage({
  loadingStatus,
  loadingMessage,
  onNext,
  onRetry,
}: {
  loadingStatus: ActStatus;
  loadingMessage: string;
  onNext: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    console.log(`[ONBOARDING] loading status ${loadingStatus}`);
    if (loadingStatus === "success") onNext();
  }, [loadingStatus]);

  return (
    <View style={ss.container.center}>
      {loadingStatus !== "error" && <ActivityIndicator size="large" />}
      {loadingStatus === "error" && (
        <ButtonBig title="Retry" onPress={onRetry} type="primary" />
      )}
      <Spacer h={32} />
      <TextCenter>
        {loadingStatus === "error" && <TextError>{loadingMessage}</TextError>}
        {loadingStatus !== "error" && (
          <TextLight>
            <EmojiToOcticon size={16} text={loadingMessage} />
          </TextLight>
        )}
      </TextCenter>
    </View>
  );
}

const styles = StyleSheet.create({
  onboardingScreen: {
    flex: 1,
  },
  introPages: {
    flex: 1,
    backgroundColor: color.white,
    alignItems: "stretch",
    justifyContent: "center",
  },
  introPageScroll: {
    flexGrow: 0,
  },
  introPage: {
    padding: 32,
    maxWidth: 480,
    alignSelf: "center",
  },
  introText: {
    ...ss.text.body,
    lineHeight: 24,
  },
  introButtonsCenter: {
    paddingHorizontal: 24,
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "center",
  },
  introButtonsWrap: {
    flexGrow: 1,
    maxWidth: 480,
  },
  paddedPage: {
    paddingTop: 64,
    paddingHorizontal: 24,
  },
});
