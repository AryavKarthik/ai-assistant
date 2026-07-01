import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { LoadingScreen } from "@/components/shell/LoadingScreen";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen fullPage />}>
      <LoginForm />
    </Suspense>
  );
}
