import ResearchShell from "@/components/research/ResearchShell";

export const metadata = { title: "LookAtMe Research" };

export default function ResearchLayout({ children }: LayoutProps<"/r">) {
  return <ResearchShell>{children}</ResearchShell>;
}
