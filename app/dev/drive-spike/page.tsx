import { notFound } from "next/navigation";
import { connection } from "next/server";
import DriveSpikeClient from "@/components/research/DriveSpikeClient";

export const metadata = {
  title: "Drive upload test — LookAtMe Research (dev)",
};

export default async function DriveSpikePage() {
  // Decide at request time (not build time) whether dev tools are enabled.
  await connection();
  if (process.env.ENABLE_DEV_TOOLS !== "1") notFound();
  return <DriveSpikeClient />;
}
