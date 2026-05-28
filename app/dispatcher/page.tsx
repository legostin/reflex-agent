import { redirect } from "next/navigation";
import { getDispatcherTopic } from "@/lib/server/home/dispatcher";

export const dynamic = "force-dynamic";

/**
 * Entry point for the central dispatcher chat. Resolves (or creates) the
 * one home-Space dispatcher topic and bounces into the normal chat view
 * — `/roots/home/chat/<id>` works because `getRoot("home")` resolves the
 * synthetic home Space.
 */
export default async function DispatcherPage() {
  const d = await getDispatcherTopic();
  redirect(`/roots/${d.rootId}/chat/${d.topicId}`);
}
