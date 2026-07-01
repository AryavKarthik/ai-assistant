import { Suspense } from "react";
import { ChatScreen } from "@/components/chat/ChatScreen";
import { LoadingScreen } from "@/components/shell/LoadingScreen";

export default function Home() {
  return (
    <Suspense fallback={<LoadingScreen className="app-root" />}>
      <ChatScreen />
    </Suspense>
  );
}
