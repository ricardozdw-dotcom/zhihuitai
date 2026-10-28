from pathlib import Path

from app.config import get_settings


class BlobStore:
    """本地目录实现。OSS/S3 以后实现同一组方法即可替换。"""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(get_settings().blob_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, key: str, data: bytes) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def _path(self, key: str) -> Path:
        safe = Path(key)
        if safe.is_absolute() or ".." in safe.parts:
            raise ValueError("非法文件键")
        return self.root / safe


def get_blob_store() -> BlobStore:
    return BlobStore()
