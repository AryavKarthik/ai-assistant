import { Suspense } from "react";
import { NotificationsPage } from "@/components/notifications/NotificationsPage";
import { LoadingScreen } from "@/components/shell/LoadingScreen";

export default function NotificationsRoute() {
  return (
    <Suspense fallback={<LoadingScreen fullPage />}>
      <NotificationsPage />
    </Suspense>
  );
}
