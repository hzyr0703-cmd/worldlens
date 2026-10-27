import sqlite3

c = sqlite3.connect('file:data/worldlens.db?mode=ro', uri=True)


def q(sql, args=()):
    return c.execute(sql, args).fetchone()[0]


BJ_TODAY = "date('now', '+8 hours')"

items_total = q('SELECT COUNT(*) FROM items')
claims_total = q('SELECT COUNT(*) FROM claims')
entities_total = q('SELECT COUNT(*) FROM entities')
atoms = q("SELECT COUNT(*) FROM nuggets WHERE status != 'retired'")
links = q('SELECT COUNT(*) FROM nugget_links')
chains = q('SELECT COUNT(*) FROM chains')
steps = q('SELECT COUNT(*) FROM chain_steps')
cards = q('SELECT COUNT(*) FROM review_cards')

orphans = q(
    "SELECT COUNT(*) FROM nuggets n WHERE n.status != 'retired' "
    "AND NOT EXISTS (SELECT 1 FROM nugget_links l WHERE l.src_id = n.id OR l.dst_id = n.id)"
)
no_trace = q("SELECT COUNT(*) FROM chain_steps WHERE item_ids = '[]' OR item_ids IS NULL")
backlog = q('SELECT COUNT(*) FROM items WHERE distilled = 0 AND length(content) >= 800')
dead = q('SELECT COUNT(*) FROM items WHERE distilled = 2')
pending_extract = q('SELECT COUNT(*) FROM items WHERE processed = 0')
today_items = q("SELECT COUNT(*) FROM items WHERE date(COALESCE(published_at, fetched_at), '+8 hours') = " + BJ_TODAY)
today_claims = q(
    "SELECT COUNT(*) FROM claims c JOIN items i ON i.id = c.item_id "
    "WHERE date(COALESCE(i.published_at, i.fetched_at), '+8 hours') = " + BJ_TODAY
)
future = q("SELECT COUNT(*) FROM items WHERE published_at > datetime('now', '+1 day')")
ancient = q("SELECT COUNT(*) FROM items WHERE fetched_at < '2016-01-01'")
dup_atoms = q('SELECT COUNT(*) FROM (SELECT statement FROM nuggets GROUP BY statement HAVING COUNT(*) > 1)')
challenged = q("SELECT COUNT(*) FROM nuggets WHERE status = 'challenged'")

print("=== 1. 数据规模 ===")
print(f"  items {items_total} · claims {claims_total} · entities {entities_total}")
print(f"  原子 {atoms} · 连边 {links} · 链 {chains}/{steps} 环 · 对账卡 {cards}")
print("\n=== 2. 数据质量 ===")
print(f"  孤立原子 {orphans}/{atoms} ({orphans * 100 // max(1, atoms)}%)")
print(f"  无溯源环节 {no_trace}/{steps}")
print(f"  蒸馏积压(≥800字) {backlog} · 永久失败 {dead} · 待抽实体 {pending_extract}")
print(f"  重复原子 {dup_atoms} · 挑战中 {challenged}")
print("\n=== 3. 时间健康 ===")
print(f"  最新 items: {q('SELECT MAX(fetched_at) FROM items')}")
print(f"  今日 items {today_items} · 今日 claims {today_claims}")
for r in c.execute("SELECT run_date, ok, substr(detail, 1, 44) FROM cron_log ORDER BY id DESC LIMIT 3"):
    print(f"  cron_log {r[0]} ok={r[1]} {r[2]}")
print("\n=== 4. 异常 ===")
print(f"  未来 published_at {future} · 2016 前数据 {ancient}")
print(f"  digests: {c.execute('SELECT date, length(content), deep FROM digests ORDER BY date DESC').fetchall()}")
print(f"  链状态: {c.execute('SELECT status, COUNT(*) FROM chains GROUP BY status').fetchall()}")
print(f"  信源: 启用 {q('SELECT COUNT(*) FROM sources WHERE enabled = 1')} / 停用 {q('SELECT COUNT(*) FROM sources WHERE enabled = 0')}")
