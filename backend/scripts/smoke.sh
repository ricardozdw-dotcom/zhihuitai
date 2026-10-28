#!/usr/bin/env bash
# 健康检查 + 建库 + 上传 Markdown + 检索 + 流式问答。
set -euo pipefail
BASE="${API_BASE:-http://127.0.0.1:43180}"

echo "GET $BASE/api/health"
curl -fsS "$BASE/api/health"
echo

KB=$(curl -fsS -X POST "$BASE/api/knowledge-bases" \
  -H 'Content-Type: application/json' \
  -d '{"name":"冒烟知识库","owner":"知识运营组","description":"smoke"}')
echo "$KB"
KB_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$KB")

TMP=$(mktemp /tmp/zhihuitai-XXXX.md)
cat >"$TMP" <<'EOF'
# 私有化部署

通用版本建议从单机 Docker Compose 起步，包含 API 与 PostgreSQL。
向量默认 1024 维，使用 pgvector。
EOF

echo "POST document"
UPLOAD=$(curl -fsS -X POST "$BASE/api/knowledge-bases/$KB_ID/documents" \
  -F "file=@${TMP};filename=部署指南.md")
echo "$UPLOAD"
python3 -c 'import json,sys; body=json.load(sys.stdin); assert body["task"]["status"]=="success"; assert body["document"]["metadata"]["subject"]' <<<"$UPLOAD"

echo "POST retrieval"
curl -fsS -X POST "$BASE/api/knowledge-bases/$KB_ID/retrieval" \
  -H 'Content-Type: application/json' \
  -d '{"query":"Docker Compose 部署","topK":3}'
echo

echo "POST chat"
curl -fsS -N -X POST "$BASE/api/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"message\":\"Docker Compose 怎么部署\",\"knowledgeBaseIds\":[\"$KB_ID\"]}"
echo
rm -f "$TMP"
echo "smoke ok"
