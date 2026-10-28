"""LangChain RAG 编排。没有供应商密钥时仍走同一条 Runnable，只是回答由摘录拼成。"""

from __future__ import annotations

from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda, RunnablePassthrough

from app.config import Settings
from app.rag.retrieve import Hit


def _format_docs(documents: list[Document]) -> str:
    blocks = []
    for index, document in enumerate(documents, start=1):
        source = document.metadata.get("source", "")
        locator = document.metadata.get("locator", "")
        blocks.append(f"[{index}] {source} {locator}\n{document.page_content}")
    return "\n\n".join(blocks)


def _mock_answer(payload: dict) -> str:
    question = payload["question"]
    documents: list[Document] = payload["documents"]
    if not documents:
        return "当前知识库没有足够证据回答这个问题。请换一种问法，或先导入相关文档。"
    excerpts = []
    for index, document in enumerate(documents, start=1):
        source = document.metadata.get("source", "")
        locator = document.metadata.get("locator", "")
        text = document.page_content.strip().replace("\n", " ")
        excerpts.append(f"[{index}] {text[:280]}（{source} · {locator}）")
    joined = "\n".join(excerpts)
    return (
        f"根据已索引的文档，和「{question}」最相关的原文如下：\n\n{joined}\n\n"
        "以上内容直接来自知识库分块，当前没有调用外部大模型。"
    )


def build_answer_chain(settings: Settings, documents: list[Document]):
    if settings.llm_configured and documents:
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "你是企业知识助手。只根据给定资料回答，用 [n] 标注引用。"
                    "资料不足以回答时，直接说明无法从当前知识库得到答案，不要编造。",
                ),
                ("human", "资料：\n{context}\n\n问题：{question}"),
            ]
        )
        from langchain_openai import ChatOpenAI

        llm = ChatOpenAI(
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            temperature=0.2,
            streaming=True,
            stream_usage=True,
            timeout=60,
            max_retries=1,
        )
        return (
            RunnablePassthrough.assign(context=lambda _: _format_docs(documents))
            | prompt
            | llm
            | StrOutputParser()
        )
    return RunnableLambda(_mock_answer)


def hits_to_documents(hits: list[Hit]) -> list[Document]:
    useful = [hit for hit in hits if hit.sufficient] or []
    return [
        Document(
            page_content=hit.content,
            metadata={"source": hit.source, "locator": hit.locator, "id": hit.chunk_id},
        )
        for hit in useful
    ]


def answer_question(question: str, hits: list[Hit], settings: Settings) -> str:
    documents = hits_to_documents(hits)
    chain = build_answer_chain(settings, documents)
    return chain.invoke({"question": question, "documents": documents})


def stream_answer(question: str, hits: list[Hit], settings: Settings, callbacks=None):
    documents = hits_to_documents(hits)
    chain = build_answer_chain(settings, documents)
    if settings.llm_configured and documents:
        yield from chain.stream({"question": question, "documents": documents}, config={"callbacks": callbacks or []})
        return
    text = chain.invoke({"question": question, "documents": documents})
    step = max(24, len(text) // 8)
    for index in range(0, len(text), step):
        yield text[index : index + step]
