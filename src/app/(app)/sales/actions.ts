"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import {
  buildSalesExecutionUpdate,
  nextStageForSalesStatus,
  parseSalesExecutionStatus,
  salesExecutionFromMetadata,
} from "@/lib/sales/execution";

function textField(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

function dateField(formData: FormData, key: string) {
  const value = textField(formData, key);
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function updateSalesExecution(formData: FormData) {
  const user = await requireCurrentUser();
  const productId = textField(formData, "productId");
  const status = parseSalesExecutionStatus(formData.get("salesStatus"));
  if (!productId) throw new Error("productId is required");
  if (!status) throw new Error("salesStatus is invalid");

  const supplierEmail = textField(formData, "supplierEmail");
  const contactName = textField(formData, "contactName");
  const contactUrl = textField(formData, "contactUrl");
  const nextFollowUpAt = dateField(formData, "nextFollowUpAt");
  const note = textField(formData, "note");
  const now = new Date().toISOString();

  const [current] = await db
    .select({
      stage: products.stage,
      metadata: products.metadata,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!current) throw new Error("対象商品が見つかりません");

  const previous = salesExecutionFromMetadata(current.metadata);
  const metadata = {
    ...(current.metadata ?? {}),
    salesExecution: buildSalesExecutionUpdate({
      previous,
      status,
      supplierEmail,
      contactName,
      contactUrl,
      nextFollowUpAt,
      note,
      now,
      userId: user.id,
      eventId: crypto.randomUUID(),
    }),
  };

  await db
    .update(products)
    .set({
      stage: nextStageForSalesStatus(current.stage, status),
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  revalidatePath("/sales");
  revalidatePath("/pipeline");
  revalidatePath("/inbox");
}
