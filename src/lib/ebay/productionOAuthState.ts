import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const TRANSACTION_LIFETIME_SECONDS = 10 * 60;

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export async function createProductionOAuthTransaction(userId: string) {
  const state = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + TRANSACTION_LIFETIME_SECONDS * 1000
  ).toISOString();
  const admin = createAdminClient();

  const { error: cleanupError } = await admin
    .from("ebay_production_oauth_transactions")
    .delete()
    .lte("expires_at", new Date().toISOString());

  if (cleanupError) {
    console.error("Could not prune expired eBay OAuth transactions:", cleanupError.message);
    throw new Error("Could not initialize eBay authorization.");
  }

  const { error: insertError } = await admin
    .from("ebay_production_oauth_transactions")
    .insert({
      state_hash: hashState(state),
      user_id: userId,
      expires_at: expiresAt,
    });

  if (insertError) {
    console.error("Could not store eBay OAuth transaction:", insertError.message);
    throw new Error("Could not initialize eBay authorization.");
  }

  return {
    state,
    maxAge: TRANSACTION_LIFETIME_SECONDS,
  };
}

export async function consumeProductionOAuthTransaction(
  state: string | null,
  userId: string
) {
  if (!state || !/^[a-f0-9]{64}$/.test(state)) return false;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ebay_production_oauth_transactions")
    .delete()
    .eq("state_hash", hashState(state))
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .select("state_hash")
    .maybeSingle();

  if (error) {
    console.error("Could not consume eBay OAuth transaction:", error.message);
    throw new Error("Could not verify eBay authorization.");
  }

  return Boolean(data);
}
