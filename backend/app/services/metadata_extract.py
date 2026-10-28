"""从文件名和正文启发式抽取文档索引字段。配置了 LLM 时由入库流程改走模型。"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass


@dataclass
class ExtractedMetadata:
    time: str
    version: str
    subject: str
    owner: str
    keywords: list[str]
    questions: list[str]

    def as_dict(self) -> dict:
        return {
            "time": self.time,
            "version": self.version,
            "subject": self.subject,
            "owner": self.owner,
            "keywords": self.keywords,
            "questions": self.questions,
        }


_SUBJECT_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile("部署"), "私有化部署"),
    (re.compile("报价|功能对照|版本功能"), "版本与报价"),
    (re.compile("常见问题|FAQ", re.I), "标准答复"),
    (re.compile("验收"), "交付验收"),
    (re.compile("巡检"), "门店巡检"),
    (re.compile("假期|考勤"), "假期与考勤"),
    (re.compile("员工手册"), "员工制度"),
    (re.compile("接口|规范"), "开放接口"),
    (re.compile("故障"), "故障处理"),
    (re.compile("合同"), "销售合同"),
    (re.compile("复盘"), "项目交付复盘"),
    (re.compile("手册"), "产品手册"),
]


def _hash_name(name: str) -> int:
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big")


def _stem(file_name: str) -> str:
    return re.sub(r"\.[^.]+$", "", file_name).strip()


def _infer_subject(file_name: str, content: str, knowledge_base_name: str) -> str:
    for pattern, subject in _SUBJECT_RULES:
        if pattern.search(file_name):
            return subject
    heading = re.search(r"^#\s+(.+)$", content, re.M)
    if heading:
        title = heading.group(1).strip()
        if len(title) >= 2:
            return title[:40]
    cleaned = re.sub(r"[_-]+", " ", _stem(file_name))
    cleaned = re.sub(r"20\d{2}(?:\s*版|Q[1-4])?", "", cleaned, flags=re.I)
    cleaned = re.sub(r"[Vv]\d+(?:\.\d+)*", "", cleaned)
    cleaned = re.sub(r"标准版|图文版|扫描件", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) >= 2:
        return cleaned[:40]
    return knowledge_base_name.removesuffix("知识库") or "未命名文档"


def _infer_version(file_name: str, content: str, digest: int) -> str:
    for source in (file_name, content[:500]):
        semver = re.search(r"[Vv](\d+(?:\.\d+)*)", source)
        if semver:
            return f"V{semver.group(1)}"
        year_edition = re.search(r"(20\d{2})\s*版", source)
        if year_edition:
            return f"{year_edition.group(1)}版"
        quarter = re.search(r"(20\d{2})\s*Q([1-4])", source, re.I)
        if quarter:
            return f"{quarter.group(1)} Q{quarter.group(2)}"
    if "标准版" in file_name:
        return "标准版"
    if "图文版" in file_name:
        return "图文版"
    return f"2026.{1 + (digest % 3)}"


def _infer_time(file_name: str, content: str, digest: int) -> str:
    explicit = re.search(r"(20\d{2})-(\d{2})-(\d{2})", content[:800])
    if explicit:
        return explicit.group(0)
    quarter = re.search(r"(20\d{2})\s*Q([1-4])", file_name, re.I)
    if quarter:
        month = f"{int(quarter.group(2)) * 3:02d}"
        last_day = "31" if quarter.group(2) in {"1", "4"} else "30"
        return f"{quarter.group(1)}-{month}-{last_day}"
    year = re.search(r"20\d{2}", file_name)
    if year:
        day = f"{10 + (digest % 18):02d}"
        return f"{year.group(0)}-10-{day}"
    month = f"{1 + (digest % 10):02d}"
    day = f"{1 + (digest % 27):02d}"
    return f"2026-{month}-{day}"


def _keywords(file_name: str, subject: str, version: str, fmt: str, knowledge_base_name: str) -> list[str]:
    tokens = [
        part.strip()
        for part in re.split(r"[\s_+·.\-]+", _stem(file_name))
        if len(part.strip()) >= 2 and not re.fullmatch(r"[\d.]+", part.strip()) and not re.match(r"v\d", part.strip(), re.I)
    ]
    knowledge = knowledge_base_name.removesuffix("知识库")[:12]
    candidates = [subject, version, fmt.upper(), *tokens, knowledge]
    seen: set[str] = set()
    keywords: list[str] = []
    for item in candidates:
        if not item or item.lower() in seen:
            continue
        seen.add(item.lower())
        keywords.append(item)
        if len(keywords) >= 6:
            break
    return keywords


def _questions(subject: str, version: str, owner: str, content: str) -> list[str]:
    found = re.findall(r"^[#\-\s]*([^#\n]{6,40}？)\s*$", content, re.M)
    questions: list[str] = []
    for item in found:
        text = item.strip()
        if text not in questions:
            questions.append(text)
        if len(questions) >= 2:
            break
    templates = [
        f"{subject}的适用范围是什么？",
        f"{subject}当前是哪个版本，和上一版有什么差别？",
        f"{subject}（{version}）由谁负责维护？",
        f"{owner}如何更新{subject}？",
    ]
    for item in templates:
        if item not in questions:
            questions.append(item)
        if len(questions) >= 4:
            break
    return questions


def extract_metadata(
    *,
    file_name: str,
    content: str,
    file_format: str,
    knowledge_base_name: str,
    owner: str,
) -> ExtractedMetadata:
    digest = _hash_name(file_name)
    subject = _infer_subject(file_name, content, knowledge_base_name)
    version = _infer_version(file_name, content, digest)
    responsible = owner.strip() or "未指定负责人"
    return ExtractedMetadata(
        time=_infer_time(file_name, content, digest),
        version=version,
        subject=subject,
        owner=responsible,
        keywords=_keywords(file_name, subject, version, file_format, knowledge_base_name),
        questions=_questions(subject, version, responsible, content),
    )
