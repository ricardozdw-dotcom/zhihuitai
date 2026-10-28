from app.services.ingest import process_document
from app.workers.celery_app import celery_app


@celery_app.task(name="ingest.document")
def ingest_document_task(document_id: str) -> None:
    process_document(document_id)
