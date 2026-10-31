import { useState } from "preact/hooks";
import { api, isReadOnly } from "../api";
import { Empty, ErrorNote, Loading, PageHeader, Stars, useLoad } from "../components";
import { PLATFORM_LABEL, timeAgo } from "../format";
import { navigate, type Route } from "../router";
import type { App, Review, ReviewPage } from "../../../src/shared/types";

export function Reviews(props: { route: Route }) {
  const params = props.route.params;
  const stars = (params.get("stars") ?? "").split(",").filter(Boolean);
  const unread = params.get("unread") === "1";
  const app = params.get("app") ?? "";
  const query = params.toString();

  const apps = useLoad(() => api.get<App[]>("/apps"));
  const { data, error, loading, setData } = useLoad(() => api.get<ReviewPage>(`/reviews?${query}`), [query]);
  const [more, setMore] = useState(false);

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(`#/reviews${next.toString() ? `?${next}` : ""}`);
  };

  const toggleStar = (s: string) => {
    const set = new Set(stars);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    setFilter("stars", [...set].sort().join(","));
  };

  const setRead = async (review: Review, read: boolean) => {
    // On the read-only demo the change is kept in the page only.
    if (!isReadOnly()) await api.post("/reviews/read", { ids: [review.id], read });
    if (!data) return;
    setData({
      ...data,
      unreadTotal: data.unreadTotal + (read ? -1 : 1),
      reviews: data.reviews.map((r) => (r.id === review.id ? { ...r, readAt: read ? new Date().toISOString() : null } : r)),
    });
  };

  const markAll = async () => {
    if (!isReadOnly()) await api.post("/reviews/read", app ? { all: true, app } : { all: true });
    if (data) setData({ ...data, unreadTotal: 0, reviews: data.reviews.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })) });
  };

  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setMore(true);
    const next = new URLSearchParams(params);
    next.set("cursor", data.nextCursor);
    const page = await api.get<ReviewPage>(`/reviews?${next}`);
    setData({ ...page, reviews: [...data.reviews, ...page.reviews] });
    setMore(false);
  };

  const appName = (id: string) => apps.data?.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      <PageHeader title="Reviews" subtitle={data ? `${data.unreadTotal} unread` : undefined}>
        <button class="button" onClick={markAll} disabled={!data || data.unreadTotal === 0}>
          Mark all read
        </button>
      </PageHeader>

      <div class="filters" role="group" aria-label="Filters">
        <select value={app} onChange={(e) => setFilter("app", e.currentTarget.value || null)} aria-label="App">
          <option value="">All apps</option>
          {apps.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div class="segmented" aria-label="Star rating">
          {["1", "2", "3", "4", "5"].map((s) => (
            <button key={s} class={stars.includes(s) ? "on" : ""} aria-pressed={stars.includes(s)} onClick={() => toggleStar(s)}>
              {s}★
            </button>
          ))}
        </div>
        <label class="check">
          <input type="checkbox" checked={unread} onChange={(e) => setFilter("unread", e.currentTarget.checked ? "1" : null)} />
          Unread only
        </label>
      </div>

      {error && <ErrorNote message={error} />}
      {!data && loading && <Loading />}
      {data && data.reviews.length === 0 && (
        <Empty>
          <p>No reviews match these filters.</p>
        </Empty>
      )}
      {data && data.reviews.length > 0 && (
        <ul class="reviews">
          {data.reviews.map((r) => (
            <li key={r.id} class={`review ${r.readAt ? "is-read" : "is-unread"}`}>
              <div class="review-meta">
                <Stars rating={r.rating} />
                <span>{appName(r.appId)}</span>
                <span class="muted">{PLATFORM_LABEL[r.platform]}</span>
                {r.territory && <span class="muted">{r.territory}</span>}
                {r.appVersion && <span class="muted">v{r.appVersion}</span>}
                <span class="muted review-time" title={r.createdAt}>
                  {timeAgo(r.createdAt)}
                </span>
              </div>
              {r.title && <h3 class="review-title">{r.title}</h3>}
              <p class="review-body">{r.body}</p>
              <div class="review-foot">
                {r.reviewer && <span class="muted">{r.reviewer}</span>}
                <button class="link-button" onClick={() => setRead(r, !r.readAt)}>
                  {r.readAt ? "Mark unread" : "Mark read"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data?.nextCursor && (
        <button class="button" onClick={loadMore} disabled={more}>
          {more ? "Loading…" : "Show more"}
        </button>
      )}
    </>
  );
}
