from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Optional
from config import supabase, gemini_model
import io
import re

router = APIRouter(prefix="/api/documents", tags=["documents"])

CHUNK_SIZE = 1500       # characters per chunk
CHUNK_OVERLAP = 200     # characters of overlap between chunks


# ── helpers ──────────────────────────────────────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract plain text from a PDF file using PyPDF2."""
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        return text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")


def chunk_text(text: str) -> List[str]:
    """Split text into overlapping chunks."""
    text = re.sub(r'\s+', ' ', text).strip()
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def simple_search(query: str, chunks: List[dict], top_k: int = 5) -> List[dict]:
    """Simple keyword-based relevance search over chunks."""
    query_words = set(query.lower().split())
    scored = []
    for chunk in chunks:
        chunk_words = set(chunk["chunk_text"].lower().split())
        overlap = len(query_words & chunk_words)
        scored.append((overlap, chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top_k]]


# ── models ───────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str
    user_id: str
    document_id: Optional[str] = None   # restrict to one doc if provided


class QueryResponse(BaseModel):
    answer: str
    sources: List[dict]


class DeleteRequest(BaseModel):
    document_id: str
    user_id: str


# ── endpoints ────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """Upload a PDF or TXT file, extract text, chunk it, and store in Supabase."""
    filename = file.filename or "document"
    file_bytes = await file.read()

    # Extract text
    if filename.lower().endswith(".pdf"):
        content = extract_text_from_pdf(file_bytes)
    elif filename.lower().endswith(".txt"):
        content = file_bytes.decode("utf-8", errors="replace")
    else:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported.")

    if not content.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from this file.")

    # Store document record
    doc_res = supabase.table("documents").insert({
        "user_id": user_id,
        "filename": filename,
        "content": content[:5000],   # store a preview only
    }).execute()

    if not doc_res.data:
        raise HTTPException(status_code=500, detail="Failed to save document record.")

    document_id = doc_res.data[0]["id"]

    # Chunk and store
    chunks = chunk_text(content)
    chunk_rows = [
        {
            "document_id": document_id,
            "user_id": user_id,
            "chunk_text": chunk,
            "chunk_index": i,
        }
        for i, chunk in enumerate(chunks)
    ]

    chunk_res = supabase.table("document_chunks").insert(chunk_rows).execute()
    if not chunk_res.data:
        raise HTTPException(status_code=500, detail="Failed to save document chunks.")

    return {
        "document_id": document_id,
        "filename": filename,
        "chunk_count": len(chunks),
        "message": f"Uploaded '{filename}' successfully — {len(chunks)} chunks indexed.",
    }


@router.get("/list/{user_id}")
async def list_documents(user_id: str):
    """List all documents uploaded by a user."""
    res = supabase.table("documents")\
        .select("id, filename, created_at")\
        .eq("user_id", user_id)\
        .order("created_at", desc=True)\
        .execute()
    return {"documents": res.data or []}


@router.post("/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest):
    """Ask a question — retrieve relevant chunks and answer with Gemini."""
    # Fetch chunks
    query = supabase.table("document_chunks")\
        .select("id, chunk_text, chunk_index, document_id")\
        .eq("user_id", request.user_id)

    if request.document_id:
        query = query.eq("document_id", request.document_id)

    res = query.execute()
    chunks = res.data or []

    if not chunks:
        raise HTTPException(
            status_code=404,
            detail="No documents found. Please upload a document first."
        )

    # Simple keyword relevance search
    relevant = simple_search(request.question, chunks, top_k=5)

    if not relevant:
        raise HTTPException(status_code=404, detail="No relevant content found for your question.")

    # Fetch filenames for sources
    doc_ids = list({c["document_id"] for c in relevant})
    docs_res = supabase.table("documents").select("id, filename").in_("id", doc_ids).execute()
    doc_map = {d["id"]: d["filename"] for d in (docs_res.data or [])}

    context = "\n\n---\n\n".join(
        f"[From: {doc_map.get(c['document_id'], 'Unknown')} — Chunk {c['chunk_index'] + 1}]\n{c['chunk_text']}"
        for c in relevant
    )

    prompt = f"""You are a helpful study assistant. Answer the student's question using ONLY the document excerpts provided below.
If the answer is not in the documents, say so clearly.

Document excerpts:
{context}

Question: {request.question}

Answer in a clear, concise way. Cite which document(s) you drew from at the end of your answer."""

    try:
        response = gemini_model.generate_content(prompt)
        answer = response.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI query failed: {str(e)}")

    sources = [
        {
            "filename": doc_map.get(c["document_id"], "Unknown"),
            "chunk_index": c["chunk_index"],
            "document_id": c["document_id"],
        }
        for c in relevant
    ]

    return QueryResponse(answer=answer, sources=sources)


@router.delete("/delete")
async def delete_document(request: DeleteRequest):
    """Delete a document and all its chunks."""
    res = supabase.table("documents")\
        .delete()\
        .eq("id", request.document_id)\
        .eq("user_id", request.user_id)\
        .execute()

    return {"message": "Document deleted successfully."}
