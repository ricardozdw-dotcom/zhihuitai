from app.services.metadata_extract import extract_metadata


def test_extracts_six_index_fields():
    metadata = extract_metadata(
        file_name="产品手册_2026版.md",
        content="# 产品手册\n\n适用范围覆盖售前与客服。",
        file_format="MD",
        knowledge_base_name="产品与解决方案知识库",
        owner="知识运营组",
    )
    assert metadata.time.startswith("2026-")
    assert metadata.version == "2026版"
    assert metadata.subject == "产品手册"
    assert metadata.owner == "知识运营组"
    assert metadata.keywords
    assert any("产品手册" in question for question in metadata.questions)


def test_different_files_differ():
    manual = extract_metadata(
        file_name="产品手册_2026版.md",
        content="",
        file_format="MD",
        knowledge_base_name="产品库",
        owner="知识运营组",
    )
    guide = extract_metadata(
        file_name="部署与运维指南_图文版.md",
        content="",
        file_format="MD",
        knowledge_base_name="产品库",
        owner="平台研发部",
    )
    assert guide.subject == "私有化部署"
    assert guide.version == "图文版"
    assert manual.subject != guide.subject
    assert manual.version != guide.version
