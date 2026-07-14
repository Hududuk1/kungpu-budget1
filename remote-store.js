(function () {
  const config = window.KUNGPU_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  const client = configured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;
  let membership = null;
  let channel = null;

  function requireClient() {
    if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
    return client;
  }

  async function ensureSession() {
    const sb = requireClient();
    let { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }
    return session;
  }

  async function invoke(action, payload = {}) {
    const sb = requireClient();
    await ensureSession();
    const { data, error } = await sb.functions.invoke("household-auth", {
      body: { action, ...payload }
    });
    if (error) {
      let message = error.message || "인증 서버 요청에 실패했습니다.";
      try {
        if (error.context && typeof error.context.json === "function") {
          const details = await error.context.json();
          message = details?.message || message;
        }
      } catch {
        // Keep the original Supabase error when the response has no JSON body.
      }
      throw new Error(message);
    }
    if (!data?.ok) throw new Error(data?.message || "요청을 처리하지 못했습니다.");
    return data;
  }

  async function status() {
    if (!configured) return { configured: false, initialized: false, profiles: {} };
    const data = await invoke("status");
    return { configured: true, ...data };
  }

  async function authenticateShared(password, setup = false) {
    return invoke(setup ? "setup_household" : "verify_shared", { password });
  }

  async function authenticateProfile(profile, password, setup = false, sharedPassword = "") {
    const data = await invoke(setup ? "setup_profile" : "login_profile", {
      profile, password, sharedPassword
    });
    membership = { householdId: data.householdId, profile };
    return data;
  }

  async function resetProfile(profile, sharedPassword, password) {
    return invoke("reset_profile", { profile, sharedPassword, password });
  }

  async function fetchMembership() {
    const sb = requireClient();
    await ensureSession();
    const { data, error } = await sb.from("memberships")
      .select("household_id, profile")
      .maybeSingle();
    if (error) throw error;
    membership = data ? { householdId: data.household_id, profile: data.profile } : null;
    return membership;
  }

  async function loadAll() {
    const sb = requireClient();
    if (!membership) await fetchMembership();
    if (!membership) throw new Error("개인 인증이 필요합니다.");
    const [entryResult, settingsResult] = await Promise.all([
      sb.from("entries").select("*")
        .eq("household_id", membership.householdId)
        .eq("owner", membership.profile)
        .order("spent_on", { ascending: false }),
      sb.from("profile_settings").select("*")
        .eq("household_id", membership.householdId)
        .eq("profile", membership.profile)
        .maybeSingle()
    ]);
    if (entryResult.error) throw entryResult.error;
    if (settingsResult.error) throw settingsResult.error;
    const settings = settingsResult.data || {};
    return {
      transactions: (entryResult.data || []).map(row => ({
        id: row.id,
        type: row.type,
        amount: Number(row.amount),
        currency: row.currency,
        date: row.spent_on,
        category: row.category,
        payment: row.payment || "",
        memo: row.memo || "",
        owner: row.owner,
        receiptPath: row.receipt_path
      })),
      budget: {
        KRW: Number(settings.budget_krw || 0),
        USD: Number(settings.budget_usd || 0)
      },
      accounts: settings.accounts || [],
      recurring: settings.recurring || []
    };
  }

  async function uploadReceipt(file, profile) {
    if (!file) return null;
    const sb = requireClient();
    const extension = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "");
    const path = `${membership.householdId}/${profile}/${crypto.randomUUID()}.${extension}`;
    const { error } = await sb.storage.from("receipts").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type || "image/jpeg",
      upsert: false
    });
    if (error) throw error;
    return path;
  }

  async function saveEntry(item, receiptFile) {
    const sb = requireClient();
    if (!membership) await fetchMembership();
    if (!membership) throw new Error("개인 인증이 필요합니다.");
    const previousPath = item.receiptPath || null;
    const receiptPath = receiptFile ? await uploadReceipt(receiptFile, membership.profile) : previousPath;
    const row = {
      household_id: membership.householdId,
      owner: membership.profile,
      type: item.type,
      amount: item.amount,
      currency: item.currency,
      spent_on: item.date,
      category: item.category,
      payment: item.payment,
      memo: item.memo,
      receipt_path: receiptPath,
      updated_at: new Date().toISOString()
    };
    const query = item.id
      ? sb.from("entries").update(row)
        .eq("id", item.id)
        .eq("owner", membership.profile)
        .select().single()
      : sb.from("entries").insert(row).select().single();
    const { data, error } = await query;
    if (error) throw error;
    if (receiptFile && previousPath && previousPath !== receiptPath) {
      await sb.storage.from("receipts").remove([previousPath]);
    }
    return data;
  }

  async function deleteEntry(item) {
    const sb = requireClient();
    const { error } = await sb.from("entries").delete()
      .eq("id", item.id)
      .eq("owner", membership.profile);
    if (error) throw error;
    if (item.receiptPath) await sb.storage.from("receipts").remove([item.receiptPath]);
  }

  async function getReceiptUrl(path) {
    const sb = requireClient();
    const { data, error } = await sb.storage.from("receipts").createSignedUrl(path, 300);
    if (error) throw error;
    return data.signedUrl;
  }

  async function saveSettings(data) {
    const sb = requireClient();
    if (!membership) await fetchMembership();
    if (!membership) throw new Error("개인 인증이 필요합니다.");
    const { error } = await sb.from("profile_settings").upsert({
      household_id: membership.householdId,
      profile: membership.profile,
      budget_krw: data.budget.KRW || 0,
      budget_usd: data.budget.USD || 0,
      accounts: data.accounts,
      recurring: data.recurring,
      updated_at: new Date().toISOString()
    }, { onConflict: "household_id,profile" });
    if (error) throw error;
  }

  function subscribe(onChange) {
    const sb = requireClient();
    if (!membership) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel(`kungpu-${membership.householdId}-${membership.profile}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "entries",
        filter: `owner=eq.${membership.profile}`
      }, onChange)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "profile_settings",
        filter: `profile=eq.${membership.profile}`
      }, onChange)
      .subscribe();
  }

  window.remoteStore = {
    configured,
    status,
    authenticateShared,
    authenticateProfile,
    resetProfile,
    loadAll,
    saveEntry,
    deleteEntry,
    getReceiptUrl,
    saveSettings,
    subscribe
  };
})();
