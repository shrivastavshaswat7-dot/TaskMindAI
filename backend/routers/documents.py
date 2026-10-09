from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Optional
from auth_utils import get_current_user, resolve_user_id
from config import supabase, gemini_model
import io
import json
import re

router = APIRouter(prefix="/api/documents", tags=["documents"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024   # 10 MB per document
CHUNK_SIZE = 1500       # characters per chunk
CHUNK_OVERLAP = 200     # characters of overlap between chunks
MAX_ANALYSIS_CHARS = 30000
ACADEMIC_DOC_KINDS = {"syllabus", "notes", "pyq"}
ALLOWED_DOC_KINDS = {"syllabus", "notes", "pyq", "other"}
ALLOWED_DIFFICULTIES = {"easy", "medium", "hard"}


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
    user_id: Optional[str] = None       # never trusted for identity; must match the signed-in user if sent
    document_id: Optional[str] = None   # restrict to one doc if provided


class QueryResponse(BaseModel):
    answer: str
    sources: List[dict]


class DeleteRequest(BaseModel):
    document_id: str
    user_id: Optional[str] = None


class AnalyzeRequest(BaseModel):
    user_id: Optional[str] = None
    subject_hint: Optional[str] = None


# ── academic analysis helpers ────────────────────────────────────────────────

def parse_gemini_json(text: str) -> dict:
    """Strip markdown fences (same approach as task prioritization) and parse JSON."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
    if text.endswith("```"):
        text = text.rsplit("```", 1)[0]
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def reconstruct_text_from_chunks(chunks: List[dict], max_chars: int = MAX_ANALYSIS_CHARS) -> str:
    """Rebuild document text from stored chunks, skipping overlap, with a safety cap."""
    ordered = sorted(chunks, key=lambda c: c.get("chunk_index", 0))
    if not ordered:
        return ""

    parts = [ordered[0].get("chunk_text") or ""]
    for chunk in ordered[1:]:
        text = chunk.get("chunk_text") or ""
        parts.append(text[CHUNK_OVERLAP:] if len(text) > CHUNK_OVERLAP else text)

    return "".join(parts)[:max_chars]


def fetch_owned_document(document_id: str, user_id: str) -> dict:
    res = supabase.table("documents")\
        .select("id, user_id, filename, doc_kind, subject_name, processing_status")\
        .eq("id", document_id)\
        .eq("user_id", user_id)\
        .limit(1)\
        .execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found.")
    return res.data[0]


def fetch_document_chunk_text(document_id: str, user_id: str) -> str:
    res = supabase.table("document_chunks")\
        .select("chunk_text, chunk_index")\
        .eq("document_id", document_id)\
        .eq("user_id", user_id)\
        .order("chunk_index", desc=False)\
        .execute()
    chunks = res.data or []
    if not chunks:
        raise RuntimeError("No document chunks found for analysis.")
    text = reconstruct_text_from_chunks(chunks)
    if not text.strip():
        raise RuntimeError("Document chunks contain no text to analyze.")
    return text


def update_document_processing(
    document_id: str,
    user_id: str,
    status: str,
    subject_name: Optional[str] = None,
    processing_error: Optional[str] = None,
):
    payload = {
        "processing_status": status,
        "processing_error": processing_error,
    }
    if subject_name is not None:
        payload["subject_name"] = subject_name
    supabase.table("documents")\
        .update(payload)\
        .eq("id", document_id)\
        .eq("user_id", user_id)\
        .execute()


def cleanup_document_extractions(document_id: str, user_id: str):
    """Remove topics/PYQs extracted from this document without deleting the subject."""
    supabase.table("pyq_items")\
        .delete()\
        .eq("document_id", document_id)\
        .eq("user_id", user_id)\
        .execute()
    supabase.table("topics")\
        .delete()\
        .eq("source_document_id", document_id)\
        .eq("user_id", user_id)\
        .not_.is_("parent_id", "null")\
        .execute()
    supabase.table("topics")\
        .delete()\
        .eq("source_document_id", document_id)\
        .eq("user_id", user_id)\
        .execute()


def _as_int(value) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_difficulty(value) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if normalized in ALLOWED_DIFFICULTIES else None


def _normalize_subject_name(extracted_subject, subject_hint: Optional[str]) -> str:
    if isinstance(extracted_subject, str) and extracted_subject.strip():
        return extracted_subject.strip()
    if subject_hint and subject_hint.strip():
        return subject_hint.strip()
    return "Unknown Subject"


def find_or_create_academic_subject(user_id: str, name: str) -> dict:
    existing = supabase.table("academic_subjects")\
        .select("id, name")\
        .eq("user_id", user_id)\
        .eq("name", name)\
        .limit(1)\
        .execute()
    if existing.data:
        return existing.data[0]

    created = supabase.table("academic_subjects").insert({
        "user_id": user_id,
        "name": name,
    }).execute()
    if created.data:
        return created.data[0]

    # Unique (user_id, name) race: fetch the row that won the insert.
    retry = supabase.table("academic_subjects")\
        .select("id, name")\
        .eq("user_id", user_id)\
        .eq("name", name)\
        .limit(1)\
        .execute()
    if retry.data:
        return retry.data[0]
    raise RuntimeError("Failed to find or create academic subject.")


def extract_academic_structure(doc_kind: str, material_text: str, subject_hint: Optional[str]) -> dict:
    hint_line = (
        f"The student indicated the subject may be: {subject_hint.strip()}"
        if subject_hint and subject_hint.strip()
        else "No subject hint was provided; infer the subject from the material."
    )

    if doc_kind == "pyq":
        schema = """{
  "subject": "Data Structures",
  "topics": [
    {
      "name": "Arrays",
      "subtopics": [
        "Searching"
      ]
    }
  ],
  "questions": [
    {
      "question": "Explain binary search.",
      "marks": 7,
      "year": 2025,
      "topic": "Searching",
      "difficulty": "medium"
    }
  ]
}"""
        extra_rules = """- Extract every distinct exam question you can identify.
- marks and year must be integers or null if unknown.
- difficulty must be one of: easy, medium, hard, or null.
- topic should match a topic or subtopic name from the topics list when possible.
"""
    else:
        schema = """{
  "subject": "Data Structures",
  "topics": [
    {
      "name": "Arrays",
      "subtopics": [
        "Traversal",
        "Searching",
        "Insertion"
      ]
    }
  ]
}"""
        extra_rules = "- Extract topics and subtopics that actually appear in the material.\n"

    prompt = f"""You are an academic material analyzer for students.

Document type: {doc_kind}
{hint_line}

Study material:
{material_text}

Respond in VALID JSON only, no markdown, no code fences. Use this exact format:
{schema}

Rules:
- Prefer the student's subject hint when it matches the material.
- Keep topic and subtopic names concise.
- subtopics may be an empty list.
{extra_rules}
"""

    response = gemini_model.generate_content(prompt)
    parsed = parse_gemini_json(response.text)
    if not isinstance(parsed, dict):
        raise ValueError("AI did not return a JSON object.")
    return parsed


def persist_academic_extraction(
    user_id: str,
    document_id: str,
    doc_kind: str,
    extracted: dict,
    subject_hint: Optional[str],
) -> dict:
    subject_name = _normalize_subject_name(extracted.get("subject"), subject_hint)
    subject = find_or_create_academic_subject(user_id, subject_name)

    cleanup_document_extractions(document_id, user_id)

    topic_name_to_id = {}
    raw_topics = extracted.get("topics") or []
    if not isinstance(raw_topics, list):
        raw_topics = []

    topic_count = 0
    for item in raw_topics:
        if isinstance(item, str):
            topic_name = item.strip()
            subtopics = []
        elif isinstance(item, dict):
            topic_name = str(item.get("name") or "").strip()
            subtopics = item.get("subtopics") or []
        else:
            continue

        if not topic_name:
            continue

        parent_res = supabase.table("topics").insert({
            "user_id": user_id,
            "subject_id": subject["id"],
            "parent_id": None,
            "name": topic_name,
            "source_document_id": document_id,
        }).execute()
        if not parent_res.data:
            raise RuntimeError("Failed to save topic.")
        parent = parent_res.data[0]
        topic_name_to_id[topic_name.lower()] = parent["id"]
        topic_count += 1

        if not isinstance(subtopics, list):
            continue
        for sub in subtopics:
            sub_name = str(sub).strip() if sub is not None else ""
            if not sub_name:
                continue
            sub_res = supabase.table("topics").insert({
                "user_id": user_id,
                "subject_id": subject["id"],
                "parent_id": parent["id"],
                "name": sub_name,
                "source_document_id": document_id,
            }).execute()
            if not sub_res.data:
                raise RuntimeError("Failed to save subtopic.")
            topic_name_to_id[sub_name.lower()] = sub_res.data[0]["id"]
            topic_count += 1

    pyq_count = 0
    if doc_kind == "pyq":
        raw_questions = extracted.get("questions") or []
        if not isinstance(raw_questions, list):
            raw_questions = []
        for q in raw_questions:
            if not isinstance(q, dict):
                continue
            question_text = str(q.get("question") or "").strip()
            if not question_text:
                continue
            mapped_topic = str(q.get("topic") or "").strip().lower()
            supabase.table("pyq_items").insert({
                "user_id": user_id,
                "subject_id": subject["id"],
                "topic_id": topic_name_to_id.get(mapped_topic),
                "document_id": document_id,
                "question_text": question_text,
                "marks": _as_int(q.get("marks")),
                "year": _as_int(q.get("year")),
                "difficulty": _normalize_difficulty(q.get("difficulty")),
            }).execute()
            pyq_count += 1

    update_document_processing(
        document_id,
        user_id,
        status="processed",
        subject_name=subject_name,
        processing_error=None,
    )

    return {
        "processing_status": "processed",
        "subject": subject_name,
        "topic_count": topic_count,
        "pyq_count": pyq_count,
        "error": None,
    }


def analyze_owned_document(document_id: str, user_id: str, subject_hint: Optional[str] = None) -> dict:
    """Run Gemini extraction for a document already owned by user_id. Chunks stay even on failure."""
    document = fetch_owned_document(document_id, user_id)
    doc_kind = document.get("doc_kind") or "other"

    if doc_kind not in ACADEMIC_DOC_KINDS:
        raise HTTPException(
            status_code=400,
            detail="Analysis is only supported for syllabus, notes, and pyq documents.",
        )

    update_document_processing(document_id, user_id, status="processing", processing_error=None)

    try:
        material_text = fetch_document_chunk_text(document_id, user_id)
        extracted = extract_academic_structure(doc_kind, material_text, subject_hint)
        return persist_academic_extraction(
            user_id=user_id,
            document_id=document_id,
            doc_kind=doc_kind,
            extracted=extracted,
            subject_hint=subject_hint,
        )
    except HTTPException:
        raise
    except Exception as e:
        cleanup_document_extractions(document_id, user_id)
        error_message = str(e)
        update_document_processing(
            document_id,
            user_id,
            status="failed",
            processing_error=error_message,
        )
        return {
            "processing_status": "failed",
            "subject": None,
            "topic_count": 0,
            "pyq_count": 0,
            "error": error_message,
        }


def empty_academic_result(status: str = "uploaded") -> dict:
    return {
        "processing_status": status,
        "subject": None,
        "topic_count": 0,
        "pyq_count": 0,
        "error": None,
    }


# ── endpoints ────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    user_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    doc_kind: str = Form("other"),
    subject_hint: Optional[str] = Form(None),
    user=Depends(get_current_user),
):
    """Upload a PDF or TXT file, extract text, chunk it, and store in Supabase.

    Academic kinds (syllabus/notes/pyq) are also analyzed with Gemini.
    Omitting doc_kind keeps the original upload-only behavior.
    """
    user_id = resolve_user_id(user, user_id)
    doc_kind = (doc_kind or "other").strip().lower()
    if doc_kind not in ALLOWED_DOC_KINDS:
        raise HTTPException(
            status_code=400,
            detail="doc_kind must be one of: syllabus, notes, pyq, other.",
        )

    filename = file.filename or "document"
    file_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB).")

    # Extract text
    if filename.lower().endswith(".pdf"):
        content = extract_text_from_pdf(file_bytes)
    elif filename.lower().endswith(".txt"):
        content = file_bytes.decode("utf-8", errors="replace")
    else:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported.")

    if not content.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from this file.")

    is_academic = doc_kind in ACADEMIC_DOC_KINDS

    # Store document record
    doc_res = supabase.table("documents").insert({
        "user_id": user_id,
        "filename": filename,
        "content": content[:5000],   # store a preview only
        "doc_kind": doc_kind,
        "processing_status": "processing" if is_academic else "uploaded",
        "processing_error": None,
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

    academic = empty_academic_result("uploaded")
    if is_academic:
        academic = analyze_owned_document(document_id, user_id, subject_hint)

    status = academic["processing_status"]
    if status == "processed":
        message = f"Uploaded '{filename}' successfully — {len(chunks)} chunks indexed and analyzed."
    elif status == "failed":
        message = f"Uploaded '{filename}' successfully — {len(chunks)} chunks indexed, but analysis failed."
    else:
        message = f"Uploaded '{filename}' successfully — {len(chunks)} chunks indexed."

    return {
        "document_id": document_id,
        "filename": filename,
        "chunk_count": len(chunks),
        "message": message,
        "processing_status": status,
        "subject": academic["subject"],
        "topic_count": academic["topic_count"],
        "pyq_count": academic["pyq_count"],
        "error": academic["error"],
    }


@router.post("/{document_id}/analyze")
async def analyze_document(document_id: str, request: AnalyzeRequest, user=Depends(get_current_user)):
    """Retry Gemini analysis for an already-uploaded document owned by this user."""
    user_id = resolve_user_id(user, request.user_id)
    result = analyze_owned_document(document_id, user_id, request.subject_hint)
    return {
        "document_id": document_id,
        **result,
    }


@router.get("/list/{user_id}")
async def list_documents(user_id: str, user=Depends(get_current_user)):
    """List all documents uploaded by the signed-in user."""
    user_id = resolve_user_id(user, user_id)   # the id in the URL is only accepted if it is the caller's own
    res = supabase.table("documents")\
        .select("id, filename, created_at")\
        .eq("user_id", user_id)\
        .order("created_at", desc=True)\
        .execute()
    return {"documents": res.data or []}


@router.post("/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest, user=Depends(get_current_user)):
    """Ask a question — retrieve relevant chunks and answer with Gemini."""
    user_id = resolve_user_id(user, request.user_id)
    # Fetch chunks
    query = supabase.table("document_chunks")\
        .select("id, chunk_text, chunk_index, document_id")\
        .eq("user_id", user_id)

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
async def delete_document(request: DeleteRequest, user=Depends(get_current_user)):
    """Delete a document and all its chunks."""
    user_id = resolve_user_id(user, request.user_id)
    res = supabase.table("documents")\
        .delete()\
        .eq("id", request.document_id)\
        .eq("user_id", user_id)\
        .execute()

    return {"message": "Document deleted successfully."}
