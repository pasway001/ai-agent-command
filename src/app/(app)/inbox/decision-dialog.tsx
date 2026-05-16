"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type DialogItem = {
  id: string;
  decision: "approve" | "reject";
  title: string;
} | null;

export function DecisionDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: DialogItem;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void> | void;
}) {
  if (item === null) return null;
  return (
    <DialogInner key={item.id} item={item} onClose={onClose} onSubmit={onSubmit} />
  );
}

function DialogInner({
  item,
  onClose,
  onSubmit,
}: {
  item: NonNullable<DialogItem>;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void> | void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isApprove = item.decision === "approve";
  const noteRequired = !isApprove;
  const noteEmpty = note.trim().length === 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isApprove ? "承認しますか？" : "却下しますか？"}
          </DialogTitle>
          <DialogDescription className="break-words">
            {item.title}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="decision-note">
              メモ
              {noteRequired ? (
                <span className="ml-1 text-destructive">*</span>
              ) : (
                <span className="ml-1 text-muted-foreground font-normal">
                  (任意)
                </span>
              )}
            </Label>
            {noteRequired ? (
              <span className="text-[11px] text-muted-foreground">
                再学習の few-shot に使用
              </span>
            ) : null}
          </div>
          <textarea
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isApprove
                ? "承認理由・特記事項など"
                : "却下理由（後段エージェントの再学習に使われます）"
            }
            rows={4}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => onClose()}
          >
            キャンセル
          </Button>
          <Button
            variant={isApprove ? "default" : "destructive"}
            disabled={submitting || (noteRequired && noteEmpty)}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onSubmit(note);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isApprove ? "承認する" : "却下する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
