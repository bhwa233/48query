"use client";

import { useState } from "react";
import type { messages } from "@/i18n/messages";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EchoResponse } from "@starter/shared";

export function ApiExample({
  apiBaseUrl,
  copy,
}: {
  apiBaseUrl: string;
  copy: (typeof messages)["en"]["home"];
}) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [response, setResponse] = useState("");
  async function submit() {
    if (!apiBaseUrl || !message.trim()) return;
    setState("loading");
    setResponse("");
    try {
      const result = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error("request failed");
      const payload = (await result.json()) as EchoResponse;
      setResponse(payload.data.message);
      setState("success");
    } catch {
      setState("error");
    }
  }
  const status =
    state === "success"
      ? copy.success
      : state === "error"
        ? copy.error
        : !apiBaseUrl
          ? copy.unavailable
          : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.exampleTitle}</CardTitle>
        <CardDescription>{copy.exampleText}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={copy.inputPlaceholder}
            maxLength={200}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={copy.inputPlaceholder}
            disabled={!apiBaseUrl || state === "loading"}
          />
          <Button
            onClick={submit}
            disabled={!apiBaseUrl || !message.trim() || state === "loading"}
          >
            {state === "loading" ? copy.loading : copy.send}
          </Button>
        </div>
        {status ? (
          <Alert variant={state === "error" ? "destructive" : "default"}>
            <AlertDescription>
              {status}
              {response ? ` ${response}` : ""}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
