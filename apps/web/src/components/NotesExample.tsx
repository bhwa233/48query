"use client";

import { useState } from "react";
import type { messages } from "@/i18n/messages";
import type { Note, NotesResponse } from "@starter/shared";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NotesExample({
  apiBaseUrl,
  copy,
}: {
  apiBaseUrl: string;
  copy: (typeof messages)["en"]["notes"];
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function request(create: boolean) {
    setBusy(true);
    try {
      const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/api/notes`;
      if (create) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          setStatus(response.status === 503 ? copy.unavailable : copy.failure);
          return;
        }
        setTitle("");
      }
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        setStatus(response.status === 503 ? copy.unavailable : copy.failure);
        return;
      }
      const payload = (await response.json()) as NotesResponse;
      setNotes(payload.data);
      setStatus(create ? copy.created : copy.loaded);
    } catch {
      setStatus(copy.failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="note-title">{copy.label}</Label>
          <Input
            id="note-title"
            maxLength={200}
            placeholder={copy.placeholder}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => request(true)}
            disabled={busy || !title.trim()}
          >
            {busy ? copy.busy : copy.create}
          </Button>
          <Button
            variant="outline"
            onClick={() => request(false)}
            disabled={busy}
          >
            {copy.load}
          </Button>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
        {notes ? (
          notes.length ? (
            <ul className="divide-y rounded-md border">
              {notes.map((note) => (
                <li className="p-3" key={note.id}>
                  {note.title}
                </li>
              ))}
            </ul>
          ) : (
            <p>{copy.empty}</p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
