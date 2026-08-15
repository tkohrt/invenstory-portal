# Service-Role Query Audit Catalog

_Auto-generated inventory of every `db.from(...)` call site. The `db` client uses the Supabase **service-role key and BYPASSES Row-Level Security** — so each of these must be justified: either (a) preceded by an RLS-verified ownership check via `userClient()`, (b) carries an explicit `tenant_id` filter, or (c) is genuinely tenant-agnostic (global tables like `grant_question`, or reads keyed by an already-verified id). The `tenant_id?` column is a heuristic (does the nearby statement mention `tenant_id`), NOT proof of safety — a human must sign off on each row._

**Total call sites: 116  ·  mention tenant_id nearby: 86  ·  need manual review: 30**

| # | File | Line | tenant_id nearby? | Statement (truncated) | Reviewer sign-off |
|---|------|------|-------------------|-----------------------|-------------------|
| 1 | `lib/server/account-actions.ts` | 17 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "change_password", detail: session.user.email }); retur` |  |
| 2 | `lib/server/account-actions.ts` | 24 | **NO** | `const { data: t } = await db.from("tenant").select("name").eq("id", session.tenantId).single(); await notifyAccountClosure({ org: t?.name ?? "a client", request` |  |
| 3 | `lib/server/account-actions.ts` | 26 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "closure_request", detail: reason.slice(0, 200) }); ret` |  |
| 4 | `lib/server/actions.ts` | 28 | **NO** | `const { data: me } = await db.from("app_user").select("role").eq("auth_id", user.id).single(); if (me?.role !== "admin") redirect("/invenstory");` |  |
| 5 | `lib/server/actions.ts` | 32 | yes | `await db.from("audit_log").insert({ actor_user_id: null, tenant_id: tenantId, action: "admin_switch_tenant", detail: `admin ${user.email} viewing tenant ${tenan` |  |
| 6 | `lib/server/admin-actions.ts` | 30 | **NO** | `const { data: dupUser } = await db.from("app_user").select("id").eq("email", email).maybeSingle(); if (dupUser) return { ok: false, error: "A user with that ema` |  |
| 7 | `lib/server/admin-actions.ts` | 32 | **NO** | `const { data: dupTenant } = await db.from("tenant").select("id").eq("name", orgName).maybeSingle(); if (dupTenant) return { ok: false, error: "A client with tha` |  |
| 8 | `lib/server/admin-actions.ts` | 41 | **NO** | `const { data: tenant, error: e2 } = await db.from("tenant") .insert({ name: orgName, org_type: input.orgType, website: input.website?.trim() \|\| null }) .select(` |  |
| 9 | `lib/server/admin-actions.ts` | 47 | yes | `const { error: e3 } = await db.from("app_user").insert({ tenant_id: tenant.id, email, full_name: contactName, role: "client", auth_id: au.user.id, });` |  |
| 10 | `lib/server/admin-actions.ts` | 53 | yes | `const { data: types } = await db.from("artifact_type").select("slug"); for (const t of (types ?? [])) await db.from("artifact_set").insert({ tenant_id: tenant.i` |  |
| 11 | `lib/server/admin-actions.ts` | 54 | yes | `for (const t of (types ?? [])) await db.from("artifact_set").insert({ tenant_id: tenant.id, type_slug: t.slug, status: "none" }); await db.from("audit_log").ins` |  |
| 12 | `lib/server/admin-actions.ts` | 56 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: tenant.id, action: "create_client", detail: `${orgName} (${input.orgType}) / ${em` |  |
| 13 | `lib/server/admin-actions.ts` | 65 | yes | `await db.from("tenant").update({ website: input.website.trim() \|\| null, org_type: input.orgType }).eq("id", input.tenantId); const { data: u } = await db.from("` |  |
| 14 | `lib/server/admin-actions.ts` | 66 | yes | `const { data: u } = await db.from("app_user").select("id") .eq("tenant_id", input.tenantId).eq("role", "client").order("created_at").limit(1).maybeSingle();` |  |
| 15 | `lib/server/admin-actions.ts` | 68 | yes | `if (u && input.contactName.trim()) await db.from("app_user").update({ full_name: input.contactName.trim() }).eq("id", u.id); await db.from("audit_log").insert({` |  |
| 16 | `lib/server/admin-actions.ts` | 69 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: input.tenantId, action: "edit_client_profile", detail: `${input.orgType} / ${inpu` |  |
| 17 | `lib/server/answer-actions.ts` | 23 | **NO** | `const { data: t } = await db.from("tenant").select("org_type").eq("id", s.tenantId).single(); await generateAnswers(s.tenantId, (t?.org_type as "nonprofit" \| "s` |  |
| 18 | `lib/server/answer-actions.ts` | 30 | yes | `await db.from("answer").upsert({ tenant_id: s.tenantId, question_id: questionId, [field]: value, source: "human", updated_at: new Date().toISOString(), }, { onC` |  |
| 19 | `lib/server/answer-actions.ts` | 34 | yes | `await db.from("answer_event").insert({ tenant_id: s.tenantId, question_id: questionId, kind: "human_edited" }); revalidatePath("/answer-library");` |  |
| 20 | `lib/server/answer-actions.ts` | 40 | yes | `await db.from("answer").update({ source: "human", status: "published", reviewed_by: s.user.id, reviewed_at: new Date().toISOString(), }).eq("tenant_id", s.tenan` |  |
| 21 | `lib/server/answer-actions.ts` | 43 | yes | `await db.from("answer_event").insert({ tenant_id: s.tenantId, question_id: questionId, kind: "reviewed" }); revalidatePath("/answer-library");` |  |
| 22 | `lib/server/answer-actions.ts` | 55 | **NO** | `await db.from("grant_question").update({ category: input.category, prompt_text: input.prompt_text, guidance: input.guidance \|\| null, audience: input.audience, s` |  |
| 23 | `lib/server/answer-actions.ts` | 60 | **NO** | `await db.from("grant_question").insert({ slug: `${slugify(input.prompt_text \|\| input.category)}-${Math.random().toString(36).slice(2, 6)}`, category: input.cate` |  |
| 24 | `lib/server/answer-actions.ts` | 71 | **NO** | `await db.from("grant_question").delete().eq("id", id); revalidatePath("/admin/questions");` |  |
| 25 | `lib/server/answers.ts` | 28 | **NO** | `const { data: questions } = await db.from("grant_question") .select("id, prompt_text, guidance").eq("active", true).in("audience", audiences).order("sort_order"` |  |
| 26 | `lib/server/answers.ts` | 32 | yes | `const { data: existing } = await db.from("answer").select("question_id, source").eq("tenant_id", tenantId); const humanLocked = new Set((existing ?? []).filter(` |  |
| 27 | `lib/server/answers.ts` | 79 | yes | `const { data: row } = await db.from("answer").upsert({ tenant_id: tenantId, question_id: q.id, short_answer: short, long_answer: long, completeness: completenes` |  |
| 28 | `lib/server/answers.ts` | 86 | yes | `await db.from("answer_citation").delete().eq("answer_id", row.id); if (citeDocs.length) { await db.from("answer_citation").insert(citeDocs.map(d => ({ answer_id` |  |
| 29 | `lib/server/answers.ts` | 88 | yes | `await db.from("answer_citation").insert(citeDocs.map(d => ({ answer_id: row.id, tenant_id: tenantId, document_id: d, })));` |  |
| 30 | `lib/server/answers.ts` | 92 | yes | `await db.from("answer_event").insert({ tenant_id: tenantId, question_id: q.id, kind: "auto_generated" }); } summary.generated++; summary[(completenessOverride ?` |  |
| 31 | `lib/server/answers.ts` | 96 | yes | `await db.from("audit_log").insert({ tenant_id: tenantId, action: "answers_generate", detail: `generated=${summary.generated} strong=${summary.strong} partial=${` |  |
| 32 | `lib/server/artifact-actions.ts` | 32 | yes | `const { data: set } = await db.from("artifact_set").select("id") .eq("tenant_id", s.tenantId).eq("type_slug", slug).single();` |  |
| 33 | `lib/server/artifact-actions.ts` | 35 | yes | `await db.from("artifact_set").update({ status: "approved", reviewed_by: s.user.id, generated_at: new Date().toISOString() }).eq("id", set.id); await db.from("au` |  |
| 34 | `lib/server/artifact-actions.ts` | 36 | yes | `await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "si_approve", detail: slug }); revalidatePath(`/story-intelligence/` |  |
| 35 | `lib/server/artifact-actions.ts` | 43 | yes | `await db.from("artifact_card").delete().eq("id", cardId).eq("tenant_id", s.tenantId); revalidatePath(`/story-intelligence/${slug}`);` |  |
| 36 | `lib/server/artifact-actions.ts` | 49 | yes | `const { data: card } = await db.from("artifact_card").select("payload").eq("id", cardId).eq("tenant_id", s.tenantId).single(); if (!card) return;` |  |
| 37 | `lib/server/artifact-actions.ts` | 51 | **NO** | `await db.from("artifact_card").update({ payload: { ...card.payload, [field]: value } }).eq("id", cardId); revalidatePath(`/story-intelligence/${slug}`);` |  |
| 38 | `lib/server/artifact-actions.ts` | 57 | yes | `await db.from("artifact_set").update({ client_visible: visible }) .eq("tenant_id", s.tenantId).eq("type_slug", slug);` |  |
| 39 | `lib/server/artifact-actions.ts` | 59 | yes | `await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "si_visibility", detail: `${slug}=${visible ? "visible" : "hidden"}` |  |
| 40 | `lib/server/artifact-actions.ts` | 66 | yes | `await db.from("feature_visibility").upsert({ tenant_id: s.tenantId, feature_key: featureKey, visible, updated_by: s.user.id, updated_at: new Date().toISOString(` |  |
| 41 | `lib/server/artifact-actions.ts` | 70 | yes | `await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "feature_visibility", detail: `${featureKey}=${visible ? "visible" ` |  |
| 42 | `lib/server/artifacts.ts` | 14 | yes | `const { data: docs } = await db.from("document") .select("id, title, layer, snippet, status, document_tag(tag), document_chunk(text)") .eq("tenant_id", tenantId` |  |
| 43 | `lib/server/artifacts.ts` | 52 | yes | `const { data: tdocs } = await db.from("document").select("id, title").eq("tenant_id", tenantId); const titleToId = new Map((tdocs ?? []).map(d => [d.title, d.id` |  |
| 44 | `lib/server/artifacts.ts` | 55 | yes | `const { data: set } = await db.from("artifact_set") .upsert({ tenant_id: tenantId, type_slug: slug, status: "pending", generated_at: new Date().toISOString(), r` |  |
| 45 | `lib/server/artifacts.ts` | 60 | **NO** | `await db.from("artifact_set").update({ version: (set.version ?? 0) + 1 }).eq("id", set.id); await db.from("artifact_card").delete().eq("set_id", set.id);` |  |
| 46 | `lib/server/artifacts.ts` | 61 | yes | `await db.from("artifact_card").delete().eq("set_id", set.id); const rows = cards.map((c, i) => ({ set_id: set.id, tenant_id: tenantId, title: c.title, payload: ` |  |
| 47 | `lib/server/artifacts.ts` | 68 | yes | `await db.from("artifact_card").insert(rows); await db.from("audit_log").insert({ tenant_id: tenantId, action: "si_generate", detail: `${slug} model=${model} car` |  |
| 48 | `lib/server/artifacts.ts` | 69 | yes | `await db.from("audit_log").insert({ tenant_id: tenantId, action: "si_generate", detail: `${slug} model=${model} cards=${rows.length}` }); await postToSlack(tena` |  |
| 49 | `lib/server/artifacts.ts` | 75 | **NO** | `const { data: t } = await db.from("tenant").select("name, slack_channel_id, slack_webhook_url").eq("id", tenantId).single(); if (!t?.slack_webhook_url) return; ` |  |
| 50 | `lib/server/artifacts.ts` | 81 | yes | `await db.from("audit_log").insert({ tenant_id: tenantId, action: "si_slack_post", detail: `${slug} -> ${t.slack_channel_id ?? "webhook"}` }); } catch { /* Slack` |  |
| 51 | `lib/server/artifacts.ts` | 87 | yes | `await db.from("artifact_set").update({ status: "stale" }).eq("tenant_id", tenantId).eq("status", "approved"); }` |  |
| 52 | `lib/server/chat-actions.ts` | 17 | yes | `await db.from("chat_session").delete() .eq("id", sessionId).eq("tenant_id", s.tenantId).eq("user_id", s.user.id);` |  |
| 53 | `lib/server/data.ts` | 156 | yes | `const { data: tenants } = await db.from("tenant").select("id, name").order("name"); const { data: docs } = await db.from("document").select("tenant_id");` |  |
| 54 | `lib/server/data.ts` | 157 | yes | `const { data: docs } = await db.from("document").select("tenant_id"); const { data: drafts } = await db.from("grant_draft").select("tenant_id, status, amount_ce` |  |
| 55 | `lib/server/data.ts` | 158 | yes | `const { data: drafts } = await db.from("grant_draft").select("tenant_id, status, amount_cents"); const dr = (drafts ?? []) as { tenant_id: string; status: strin` |  |
| 56 | `lib/server/doc-actions.ts` | 18 | yes | `await db.from("document_tag").delete().eq("document_id", documentId).eq("tenant_id", doc.tenant_id); if (clean.length) await db.from("document_tag").insert(clea` |  |
| 57 | `lib/server/doc-actions.ts` | 19 | yes | `if (clean.length) await db.from("document_tag").insert(clean.map(tag => ({ document_id: documentId, tenant_id: doc.tenant_id, tag }))); await db.from("audit_log` |  |
| 58 | `lib/server/doc-actions.ts` | 20 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "edit_tags", detail: `${documentId} -> [${clean.join(", ")` |  |
| 59 | `lib/server/doc-actions.ts` | 33 | yes | `await db.from("document").update({ title: clean }).eq("id", documentId).eq("tenant_id", doc.tenant_id); await db.from("audit_log").insert({ actor_user_id: sessi` |  |
| 60 | `lib/server/doc-actions.ts` | 34 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "rename_doc", detail: `${documentId} -> ${clean}` }); reva` |  |
| 61 | `lib/server/doc-actions.ts` | 48 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "reprocess_doc", detail: documentId }); revalidatePath("/i` |  |
| 62 | `lib/server/doc-actions.ts` | 61 | **NO** | `await db.from("draft_bracket").update({ filed_document_id: null }).eq("filed_document_id", documentId); const folder = doc.storage_key.split("/").slice(0, 2).jo` |  |
| 63 | `lib/server/doc-actions.ts` | 67 | yes | `await db.from("document").delete().eq("id", documentId).eq("tenant_id", doc.tenant_id); await db.from("audit_log").insert({ actor_user_id: session.user.id, tena` |  |
| 64 | `lib/server/doc-actions.ts` | 68 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "delete_doc", detail: documentId }); revalidatePath("/inve` |  |
| 65 | `lib/server/doc-actions.ts` | 82 | yes | `await db.from("document").update({ layer, updated_at: new Date().toISOString() }).eq("id", documentId).eq("tenant_id", doc.tenant_id); await db.from("audit_log"` |  |
| 66 | `lib/server/doc-actions.ts` | 83 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "change_layer", detail: `${documentId}: ${doc.layer} -> ${` |  |
| 67 | `lib/server/draft-actions.ts` | 28 | yes | `await db.from("grant_draft").update(row).eq("id", draftId).eq("tenant_id", s.tenantId); } else { const { data } = await db.from("grant_draft").insert(row).selec` |  |
| 68 | `lib/server/draft-actions.ts` | 30 | **NO** | `const { data } = await db.from("grant_draft").insert(row).select("id").single(); draftId = data?.id;` |  |
| 69 | `lib/server/draft-actions.ts` | 36 | yes | `const { data: existing } = await db.from("draft_bracket").select("id, label").eq("draft_id", draftId).eq("tenant_id", s.tenantId); const have = new Map((existin` |  |
| 70 | `lib/server/draft-actions.ts` | 42 | **NO** | `if (toInsert.length) await db.from("draft_bracket").insert(toInsert); const gone = (existing ?? []).filter(b => !labels.includes(b.label));` |  |
| 71 | `lib/server/draft-actions.ts` | 45 | yes | `for (const g of gone) await db.from("draft_bracket").delete().eq("id", g.id).is("answer", null); await db.from("audit_log").insert({ actor_user_id: s.user.id, t` |  |
| 72 | `lib/server/draft-actions.ts` | 46 | yes | `await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "draft_save", detail: input.title }); revalidatePath("/drafts");` |  |
| 73 | `lib/server/draft-actions.ts` | 53 | yes | `await db.from("grant_draft").update({ status, outcome_note: outcomeNote ?? null }).eq("id", draftId).eq("tenant_id", s.tenantId); await db.from("audit_log").ins` |  |
| 74 | `lib/server/draft-actions.ts` | 54 | yes | `await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "draft_status", detail: `${status}` }); revalidatePath("/drafts");` |  |
| 75 | `lib/server/draft-actions.ts` | 63 | yes | `const { data: bracket } = await db.from("draft_bracket").select("*").eq("id", bracketId).eq("tenant_id", s.tenantId).single(); if (!bracket) throw new Error("br` |  |
| 76 | `lib/server/draft-actions.ts` | 68 | yes | `const { data: draft } = await db.from("grant_draft").select("title").eq("id", draftId).eq("tenant_id", s.tenantId).single(); if (!draft) throw new Error("draft ` |  |
| 77 | `lib/server/draft-actions.ts` | 76 | yes | `await db.from("document").insert({ id: docId, tenant_id: s.tenantId, title: `Answer: ${bracket.label}`, layer: "II", storage_key: storageKey, mime_type: "text/p` |  |
| 78 | `lib/server/draft-actions.ts` | 81 | yes | `await db.from("document_version").insert({ document_id: docId, tenant_id: s.tenantId, version: 1, storage_key: storageKey, uploaded_by: s.user.id }); await db.f` |  |
| 79 | `lib/server/draft-actions.ts` | 82 | yes | `await db.from("document_tag").insert([ { document_id: docId, tenant_id: s.tenantId, tag: "grant-answer" }, { document_id: docId, tenant_id: s.tenantId, tag: "ca` |  |
| 80 | `lib/server/draft-actions.ts` | 89 | **NO** | `await db.from("draft_bracket").update({ answer, answered_by: s.user.id, answered_at: new Date().toISOString(), filed_document_id: docId, }).eq("id", bracketId);` |  |
| 81 | `lib/server/draft-actions.ts` | 92 | yes | `await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "bracket_answer", detail: bracket.label }); revalidatePath("/drafts` |  |
| 82 | `lib/server/garden-actions.ts` | 22 | yes | `await db.from("plant_state").upsert({ tenant_id: s.tenantId, ...patch }, { onConflict: "tenant_id" }); revalidatePath("/invenstory");` |  |
| 83 | `lib/server/garden-email.ts` | 84 | **NO** | `const { data: tenants } = await db.from("tenant").select("id, name"); let sent = 0;` |  |
| 84 | `lib/server/garden-email.ts` | 87 | yes | `const { data: contact } = await db.from("app_user").select("email").eq("tenant_id", t.id).eq("role", "client").order("created_at").limit(1).maybeSingle(); if (!` |  |
| 85 | `lib/server/garden-email.ts` | 99 | **NO** | `const { data: t } = await db.from("tenant").select("name").eq("id", tenantId).single(); const g = await getGardenState(tenantId);` |  |
| 86 | `lib/server/garden.ts` | 16 | yes | `db.from("document").select("layer, created_at").eq("tenant_id", tenantId).eq("status", "ready"), db.rpc("tenant_word_count", { p_tenant: tenantId }), db.from("p` |  |
| 87 | `lib/server/garden.ts` | 18 | yes | `db.from("plant_state").select("*").eq("tenant_id", tenantId).maybeSingle(), db.from("achievement").select("key, unlocked_at").eq("tenant_id", tenantId), db.from` |  |
| 88 | `lib/server/garden.ts` | 19 | yes | `db.from("achievement").select("key, unlocked_at").eq("tenant_id", tenantId), db.from("grant_draft").select("status, updated_at").eq("tenant_id", tenantId), db.f` |  |
| 89 | `lib/server/garden.ts` | 20 | yes | `db.from("grant_draft").select("status, updated_at").eq("tenant_id", tenantId), db.from("answer").select("source, status").eq("tenant_id", tenantId), db.from("te` |  |
| 90 | `lib/server/garden.ts` | 21 | yes | `db.from("answer").select("source, status").eq("tenant_id", tenantId), db.from("tenant").select("created_at").eq("id", tenantId).single(),` |  |
| 91 | `lib/server/garden.ts` | 22 | **NO** | `db.from("tenant").select("created_at").eq("id", tenantId).single(), ]);` |  |
| 92 | `lib/server/garden.ts` | 56 | yes | `await db.from("achievement").insert(earned.map(key => ({ tenant_id: tenantId, key }))); } const allKeys = [...have, ...earned];` |  |
| 93 | `lib/server/garden.ts` | 143 | yes | `db.from("tenant").select("id"), db.from("document").select("tenant_id, layer, created_at").eq("status", "ready"), db.from("plant_state").select("*"), db.from("a` |  |
| 94 | `lib/server/garden.ts` | 144 | yes | `db.from("document").select("tenant_id, layer, created_at").eq("status", "ready"), db.from("plant_state").select("*"), db.from("achievement").select("tenant_id")` |  |
| 95 | `lib/server/garden.ts` | 145 | yes | `db.from("plant_state").select("*"), db.from("achievement").select("tenant_id"), ]);` |  |
| 96 | `lib/server/garden.ts` | 146 | yes | `db.from("achievement").select("tenant_id"), ]);` |  |
| 97 | `lib/server/ingest.ts` | 110 | **NO** | `const { data: doc } = await db.from("document").select("*").eq("id", documentId).single(); if (!doc) throw new Error("document not found");` |  |
| 98 | `lib/server/ingest.ts` | 112 | **NO** | `await db.from("document").update({ status: "processing", error_detail: null }).eq("id", documentId); try { const { data: blob, error: dlErr } = await db.storage` |  |
| 99 | `lib/server/ingest.ts` | 123 | **NO** | `await db.from("document_chunk").delete().eq("document_id", documentId); let embedFailure: string \| null = null;` |  |
| 100 | `lib/server/ingest.ts` | 126 | yes | `const { data: row, error } = await db.from("document_chunk").insert({ document_id: documentId, tenant_id: doc.tenant_id, ...c, embedding_model: EMBED_MODEL, }).` |  |
| 101 | `lib/server/ingest.ts` | 133 | yes | `const { error: eErr } = await db.from("chunk_embedding").insert({ chunk_id: row.id, tenant_id: doc.tenant_id, embedding: JSON.stringify(vector), });` |  |
| 102 | `lib/server/ingest.ts` | 142 | **NO** | `await db.from("document").update({ status: "ready", snippet, error_detail: embedFailure ? `semantic index pending: ${embedFailure}` : null, }).eq("id", document` |  |
| 103 | `lib/server/ingest.ts` | 147 | **NO** | `await db.from("document").update({ status: "failed", error_detail: e instanceof Error ? e.message.slice(0, 300) : "unknown error", }).eq("id", documentId);` |  |
| 104 | `lib/server/session.ts` | 17 | **NO** | `const { data: user } = await db.from("app_user").select("*").eq("auth_id", authUser.id).single(); if (!user) return null;` |  |
| 105 | `lib/server/session.ts` | 24 | **NO** | `const { data: t } = await db.from("tenant").select("id").order("name").limit(1).single(); tenantId = t?.id ?? null;` |  |
| 106 | `app/api/chat/route.ts` | 14 | **NO** | `const { count } = await db.from("chat_message") .select("id", { count: "exact", head: true }) .eq("author_user_id", userId).eq("role", "user").gte("created_at",` |  |
| 107 | `app/api/chat/route.ts` | 56 | yes | `await db.from("chat_message").insert([ { session_id: sid, tenant_id: session.tenantId, author_user_id: session.user.id, role: "user", content: q, citations: [] ` |  |
| 108 | `app/api/chat/route.ts` | 69 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "chat", detail: `q="${q.slice(0, 60)}" mode=${answer.mo` |  |
| 109 | `app/api/answers/generate/route.ts` | 14 | **NO** | `const { data: t } = await db.from("tenant").select("org_type").eq("id", session.tenantId).single(); const r = await generateAnswers(session.tenantId, (t?.org_ty` |  |
| 110 | `app/api/ingest/route.ts` | 13 | yes | `const { data: doc } = await db.from("document").select("id, tenant_id").eq("id", documentId).single(); if (!doc) return NextResponse.json({ error: "not found" }` |  |
| 111 | `app/api/search/route.ts` | 39 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "search", detail: `q="${q.slice(0, 80)}" hits=${results` |  |
| 112 | `app/api/export/route.ts` | 45 | yes | `await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "export_inventory", detail: `${(docs ?? []).length} doc` |  |
| 113 | `app/api/upload/route.ts` | 39 | yes | `const { error: docErr } = await db.from("document").insert({ id: docId, tenant_id: tenantId, title: title \|\| file.name, layer, original_name: file.name, storage` |  |
| 114 | `app/api/upload/route.ts` | 47 | yes | `await db.from("document_version").insert({ document_id: docId, tenant_id: tenantId, version: 1, storage_key: storageKey, uploaded_by: session.user.id, });` |  |
| 115 | `app/api/upload/route.ts` | 50 | yes | `if (tags.length) await db.from("document_tag").insert( tags.map(tag => ({ document_id: docId, tenant_id: tenantId, tag })));` |  |
| 116 | `app/api/upload/route.ts` | 58 | **NO** | `const { data: t } = await db.from("tenant").select("name").eq("id", tenantId).single(); await notifyClientUpload({ org: t?.name ?? "a client", uploader: session` |  |

## How to clear this catalog

1. For each row, open the file at the line and trace how tenancy is enforced.
2. Mark the sign-off column: `verified: RLS-checked`, `verified: explicit filter`, `verified: global table`, or `FIX NEEDED`.
3. Any `FIX NEEDED` is a potential cross-tenant leak — fix before launch.
4. Consider an ESLint rule flagging `db.from` so new service-role usage always gets reviewed.
