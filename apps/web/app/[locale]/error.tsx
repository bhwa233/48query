"use client";

import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { messages } from "@/i18n/messages";

export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const locale = useParams<{ locale: string }>().locale === "zh" ? "zh" : "en";
  const copy = messages[locale].errors;
  return (
    <div className="p-8" role="alert">
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="my-4 text-muted-foreground">{copy.description}</p>
      <Button onClick={reset}>{copy.retry}</Button>
    </div>
  );
}
