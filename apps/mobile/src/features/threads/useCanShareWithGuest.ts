import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { canShareWithGuest } from "./guestShareAvailability";

/**
 * Whether this environment offers "Share with guest": the user may create links there, and its
 * Guest links beta is on (Settings > Labs). The server refuses links while the beta is off.
 * Guests arrive through T3 Connect, so a policy that turns Connect off hides sharing too.
 */
export function useCanShareWithGuest(environmentId: EnvironmentId | null): boolean {
  const permitted = useAtomValue(serverEnvironment.createGuestShare.permissionAtom(environmentId));
  const shareable = useAtomValue(environmentServerConfigsAtom, (configs) =>
    canShareWithGuest(permitted, environmentId === null ? undefined : configs.get(environmentId)),
  );
  // Guest links need T3 Connect, which OminaX builds without cloud config lack (D37).
  return shareable && hasCloudPublicConfig();
}
