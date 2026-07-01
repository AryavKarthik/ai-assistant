import { Suspense } from "react";
import { ConnectionsPage } from "@/components/connections/ConnectionsPage";
import { LoadingScreen } from "@/components/shell/LoadingScreen";

export default function ConnectionsRoute() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ConnectionsPage />
    </Suspense>
  );
}
