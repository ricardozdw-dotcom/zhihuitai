from io import BytesIO

from pypdf import PdfReader


class ParseError(Exception):
    pass


def parse_document(file_name: str, data: bytes) -> tuple[str, str, str]:
    """返回 (正文, parser 名称, 带页标记的正文)。页标记形如 \\f页码\\n。"""
    suffix = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if suffix in {"md", "txt", "csv", "tsv"}:
        text = data.decode("utf-8-sig")
        if not text.strip():
            raise ParseError("解析结果为空，未写入索引")
        label = "Markdown 文本" if suffix == "md" else "纯文本"
        return text, label, text
    if suffix == "pdf":
        reader = PdfReader(BytesIO(data))
        pages: list[str] = []
        for index, page in enumerate(reader.pages, start=1):
            extracted = page.extract_text() or ""
            if extracted.strip():
                pages.append(f"\f{index}\n{extracted.strip()}")
        if not pages:
            raise ParseError("未检测到文本层。云 OCR 尚未接入，扫描件暂不能入库。")
        body = "\n\n".join(pages)
        return body, "PDF 文本层", body
    raise ParseError("当前仅解析 Markdown、纯文本、CSV 和带文本层的 PDF")
