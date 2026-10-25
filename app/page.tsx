import { redirect } from "next/navigation";

// Research app: everything starts behind the login at /r.
// (The original public home page, components/HomeClient.tsx, is kept for upstream merges.)
export default function Home() {
  redirect("/r");
}
