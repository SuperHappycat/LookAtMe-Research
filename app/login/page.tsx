import { Suspense } from "react";
import LoginClient from "@/components/research/LoginClient";

export const metadata = { title: "Log in — LookAtMe Research" };

export default function LoginPage() {
  // useSearchParams() needs a Suspense boundary.
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
