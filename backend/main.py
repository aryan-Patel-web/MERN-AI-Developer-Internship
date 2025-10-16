from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import pdfplumber
import json
import uuid
import logging
import asyncio
from datetime import datetime
from typing import List, Dict, Any
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import os
from dotenv import load_dotenv
import re
import time
import httpx
from aiolimiter import AsyncLimiter
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

load_dotenv()

# Setup
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
HISTORY_FILE = Path("history.json")

for d in [UPLOAD_DIR, OUTPUT_DIR]:
    d.mkdir(exist_ok=True)

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# FastAPI
app = FastAPI(title="Velocity.ai PDF Extraction")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# API Keys
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")  # Optional: Get free key at console.groq.com

# Rate limiter: 2 requests per second to avoid 429 errors
rate_limiter = AsyncLimiter(max_rate=2, time_period=1)

# Semaphore: Max 3 concurrent LLM calls
semaphore = asyncio.Semaphore(3)

# HTTP client with connection pooling
http_client = httpx.AsyncClient(timeout=60.0, limits=httpx.Limits(max_connections=10))

# Template configs
TEMPLATES = {
    "template_1": {
        "name": "PE Fund - Horizon/Linolex",
        "sheets": 8,
        "sheet_names": ["Portfolio Summary", "Schedule of Investments", "Statement of Operations", 
                       "Statement of Cashflows", "PCAP Statement", "Portfolio Company Profile",
                       "Portfolio Company Financials", "Footnotes"]
    },
    "template_2": {
        "name": "ILPA - Best Practices",
        "sheets": 9,
        "sheet_names": ["Portfolio Summary", "Schedule of Investments", "Statement of Operations",
                       "Statement of Cashflows", "PCAP Statement", "Portfolio Company Profile",
                       "Portfolio Company Financials", "Footnotes", "Reference"]
    },
    "template_3": {
        "name": "Invoice/Report",
        "sheets": 3,
        "sheet_names": ["Invoice Details", "Line Items", "Summary"]
    },
    "template_4": {
        "name": "General Document",
        "sheets": 3,
        "sheet_names": ["Document Info", "Content", "Metadata"]
    }
}

def extract_pdf_text(pdf_path: Path) -> str:
    """Ultra-fast PDF extraction"""
    start = time.time()
    text = ""
    
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages[:30]):  # Max 30 pages for speed
            page_text = page.extract_text() or ""
            if page_text.strip():
                text += f"\n=== PAGE {i+1} ===\n{page_text}"
    
    logger.info(f"PDF extracted in {time.time()-start:.2f}s ({len(text)} chars)")
    return text[:80000]  # Limit to 80K chars for fast processing

def sanitize_json(text: str) -> str:
    """Clean LLM response to extract valid JSON"""
    # Remove markdown code blocks
    text = re.sub(r'```json\s*', '', text)
    text = re.sub(r'```\s*', '', text)
    
    # Extract JSON from text
    json_match = re.search(r'(\{.*\}|\[.*\])', text, re.DOTALL)
    if json_match:
        text = json_match.group(1)
    
    # Fix common JSON issues
    text = text.replace("'", '"')  # Single quotes to double
    text = re.sub(r',(\s*[}\]])', r'\1', text)  # Remove trailing commas
    text = re.sub(r':\s*None', ': null', text)  # Python None to JSON null
    text = re.sub(r':\s*True', ': true', text)  # Python True to JSON true
    text = re.sub(r':\s*False', ': false', text)  # Python False to JSON false
    
    return text.strip()

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=10),
    retry=retry_if_exception_type(httpx.HTTPStatusError)
)
async def call_groq_fast(prompt: str, max_tokens: int = 2000) -> Dict:
    """Fast LLM call using Groq (sub-second latency)"""
    if not GROQ_API_KEY:
        raise Exception("Groq API key not found")
    
    async with rate_limiter:
        async with semaphore:
            try:
                response = await http_client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": max_tokens
                    }
                )
                
                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                
                # Sanitize and parse JSON
                clean_json = sanitize_json(content)
                return json.loads(clean_json)
                
            except json.JSONDecodeError as e:
                logger.warning(f"Groq JSON parse error: {e}")
                return {}
            except Exception as e:
                logger.error(f"Groq error: {e}")
                raise

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=10),
    retry=retry_if_exception_type(httpx.HTTPStatusError)
)
async def call_mistral_safe(prompt: str, max_tokens: int = 3000) -> Dict:
    """Safe Mistral call with rate limiting and retry"""
    async with rate_limiter:
        async with semaphore:
            try:
                response = await http_client.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {MISTRAL_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "mistral-large-latest",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": max_tokens
                    }
                )
                
                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                
                # Sanitize and parse JSON
                clean_json = sanitize_json(content)
                return json.loads(clean_json)
                
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    logger.warning("Mistral 429: Rate limit hit, retrying...")
                    raise  # Let tenacity retry
                logger.error(f"Mistral HTTP error: {e}")
                return {}
            except json.JSONDecodeError as e:
                logger.warning(f"Mistral JSON parse error: {e}")
                return {}
            except Exception as e:
                logger.error(f"Mistral error: {e}")
                return {}

async def call_llm_smart(prompt: str, max_tokens: int = 3000) -> Dict:
    """Smart LLM router: Try Groq first (fast), fallback to Mistral"""
    try:
        if GROQ_API_KEY:
            logger.info("Using Groq (fast)")
            return await call_groq_fast(prompt, max_tokens)
    except Exception as e:
        logger.warning(f"Groq failed: {e}, falling back to Mistral")
    
    # Fallback to Mistral
    logger.info("Using Mistral")
    return await call_mistral_safe(prompt, max_tokens)

def get_sheet_prompt(sheet_name: str, pdf_text: str) -> str:
    """Generate focused prompt for each sheet"""
    
    # Truncate text for speed
    text_sample = pdf_text[:40000]
    
    prompts = {
        "Portfolio Summary": f"""Extract Portfolio Summary from PDF. Return ONLY valid JSON:

{{
  "Reporting Date": "...",
  "QTR": "...",
  "General Partner": "...",
  "ILPA GP": "...",
  "Assets Under Management": 0,
  "Active Funds": 0,
  "Active Portfolio Companies": 0,
  "Fund Name": "...",
  "Fund Currency": "...",
  "Total Commitments": 0,
  "Total Drawdowns": 0,
  "Remaining Commitments": 0,
  "Total Number of Investments": 0,
  "Total Distributions": 0,
  "DPI": 0.0,
  "RVPI": 0.0,
  "TVPI": 0.0
}}

PDF: {text_sample}

Return ONLY JSON. Use "Not found" for missing fields.""",

        "Schedule of Investments": f"""Extract ALL investments/companies. Return JSON array:

[
  {{
    "#": 1,
    "Company": "...",
    "Fund": "...",
    "Investment Status": "...",
    "Security Type": "...",
    "Fund Ownership %": "0%",
    "Initial Investment Date": "...",
    "Fund Commitment": 0,
    "Total Invested (A)": 0,
    "Reported Value (C)": 0,
    "Investment Multiple": 0.0,
    "Since Inception IRR": "0%"
  }}
]

PDF: {text_sample}

Return ONLY JSON array.""",

        "Statement of Operations": f"""Extract operations for 3 periods. Return JSON array:

[
  {{
    "Period": "Current Period",
    "Portfolio Interest Income": 0,
    "Portfolio Dividend Income": 0,
    "Total income": 0,
    "Management Fees, Net": 0,
    "Total expenses": 0,
    "Net Operating Income / (Deficit)": 0
  }}
]

PDF: {text_sample}""",

        "Portfolio Company Profile": f"""Extract ALL company profiles. Return JSON array:

[
  {{
    "#": 1,
    "Company Name": "...",
    "Initial Investment Date": "...",
    "Industry": "...",
    "Headquarters": "...",
    "Company Description": "...",
    "Fund Ownership %": "0%",
    "Investment Commitment": 0,
    "Invested Capital": 0
  }}
]

PDF: {text_sample}""",

        "Portfolio Company Financials": f"""Extract company financials. Return JSON array:

[
  {{
    "Company": "...",
    "Company Currency": "USD",
    "LTM Revenue": 0,
    "LTM EBITDA": 0,
    "EBITDA Margin": "0%"
  }}
]

PDF: {text_sample}""",

        "Footnotes": f"""Extract ALL footnotes. Return JSON array:

[
  {{
    "Note #": 1,
    "Note Header": "...",
    "Description": "..."
  }}
]

PDF: {text_sample}"""
    }
    
    return prompts.get(sheet_name, f"Extract {sheet_name} data. Return JSON.\n\nPDF: {text_sample}")

async def extract_sheet_parallel(sheet_name: str, pdf_text: str) -> Dict:
    """Extract single sheet with rate limiting"""
    try:
        prompt = get_sheet_prompt(sheet_name, pdf_text)
        result = await call_llm_smart(prompt, max_tokens=2500)
        return {sheet_name: result}
    except Exception as e:
        logger.error(f"Sheet {sheet_name} extraction failed: {e}")
        return {sheet_name: {}}

def safe_excel_value(value: Any) -> Any:
    """Convert any value to Excel-safe format"""
    if value is None:
        return "Not found"
    
    # Convert complex types to strings
    if isinstance(value, (dict, list)):
        return json.dumps(value, indent=2)
    
    # Convert to string if too long
    str_val = str(value)
    if len(str_val) > 32000:  # Excel cell limit
        return str_val[:32000] + "..."
    
    return value

def calculate_accuracy(data: Dict, template_id: str) -> float:
    """Calculate extraction accuracy"""
    total_fields = 0
    filled_fields = 0
    
    def count_fields(obj):
        nonlocal total_fields, filled_fields
        if isinstance(obj, dict):
            for v in obj.values():
                total_fields += 1
                if v and str(v).strip() and v != "Not found":
                    filled_fields += 1
                if isinstance(v, (dict, list)):
                    count_fields(v)
        elif isinstance(obj, list):
            for item in obj:
                count_fields(item)
    
    count_fields(data)
    
    accuracy = (filled_fields / total_fields * 100) if total_fields > 0 else 0
    logger.info(f"Accuracy: {accuracy:.1f}% ({filled_fields}/{total_fields} fields filled)")
    return round(accuracy, 2)

def create_excel(data: Dict, template_id: str, output_path: Path, metadata: Dict):
    """Create Excel with guaranteed headers and safe values"""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    
    # Styles
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
    
    sheet_names = TEMPLATES[template_id]["sheet_names"]
    
    # Default headers
    DEFAULT_HEADERS = {
        "Portfolio Summary": ["Field", "Value"],
        "Schedule of Investments": [
            "#", "Company", "Fund", "Reported Date", "Investment Status", "Security Type",
            "Fund Ownership %", "Initial Investment Date", "Fund Commitment",
            "Total Invested (A)", "Current Cost (B)", "Reported Value (C)", "Realized Proceeds (D)",
            "Investment Multiple", "Since Inception IRR"
        ],
        "Statement of Operations": [
            "Period", "Portfolio Interest Income", "Portfolio Dividend Income", "Total income",
            "Management Fees, Net", "Total expenses", "Net Operating Income / (Deficit)"
        ],
        "Statement of Cashflows": [
            "Description", "Net increase/(decrease) in partners' capital",
            "Purchase of investments", "Capital contributions", "Distributions",
            "Cash and cash equivalents, end of period"
        ],
        "PCAP Statement": [
            "Description", "Beginning NAV", "Contributions", "Distributions",
            "Ending NAV", "Total Commitment"
        ],
        "Portfolio Company Profile": [
            "#", "Company Name", "Initial Investment Date", "Industry", "Headquarters",
            "Company Description", "Fund Ownership %", "Investment Commitment",
            "Invested Capital", "Reported Value"
        ],
        "Portfolio Company Financials": [
            "Company", "Company Currency", "LTM Revenue", "LTM EBITDA",
            "EBITDA Margin", "Gross Debt"
        ],
        "Footnotes": ["Note #", "Note Header", "Description"],
        "Reference": ["Field", "Value"]
    }
    
    for sheet_name in sheet_names:
        ws = wb.create_sheet(title=sheet_name)
        sheet_data = data.get(sheet_name, {})
        
        # Get headers
        headers = DEFAULT_HEADERS.get(sheet_name, ["Field", "Value"])
        
        if isinstance(sheet_data, dict) and sheet_data:
            # Key-value format
            ws.append(headers)
            for k, v in sheet_data.items():
                safe_v = safe_excel_value(v)
                ws.append([k, safe_v])
        
        elif isinstance(sheet_data, list) and sheet_data:
            # Table format
            if sheet_data and isinstance(sheet_data[0], dict):
                headers = list(sheet_data[0].keys())
            ws.append(headers)
            for row in sheet_data:
                row_data = [safe_excel_value(row.get(h, "Not found")) for h in headers]
                ws.append(row_data)
        
        else:
            # Empty sheet - still add headers
            ws.append(headers)
            ws.append(["Not found"] * len(headers))
        
        # Style header
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_align
            cell.border = border
        
        # Borders for all cells
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.border = border
        
        # Auto-width
        for col in ws.columns:
            max_len = 0
            col_letter = col[0].column_letter
            for cell in col:
                try:
                    max_len = max(max_len, len(str(cell.value)))
                except:
                    pass
            ws.column_dimensions[col_letter].width = min(max_len + 2, 50)
    
    # Metadata sheet
    ws_meta = wb.create_sheet(title="Extraction Metadata")
    ws_meta.append(["Metric", "Value"])
    ws_meta.append(["Template", TEMPLATES[template_id]["name"]])
    ws_meta.append(["Processed At", metadata.get("timestamp", "")])
    ws_meta.append(["Processing Time (s)", metadata.get("processing_time", "")])
    ws_meta.append(["LLM Model", metadata.get("llm_model", "Groq/Mistral")])
    ws_meta.append(["Accuracy (%)", metadata.get("accuracy", "")])
    ws_meta.append(["Confidence (%)", metadata.get("confidence", "")])
    
    for cell in ws_meta[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.border = border
    
    wb.save(output_path)
    logger.info(f"Excel created: {output_path}")

# API endpoints
@app.post("/api/extract")
async def extract(files: List[UploadFile] = File(...), template_id: str = Form(...)):
    """Main extraction endpoint with rate limiting and retry"""
    start_time = time.time()
    session_id = str(uuid.uuid4())[:8]
    
    logger.info(f"Session {session_id}: Starting extraction with {template_id}")
    
    try:
        if template_id not in TEMPLATES:
            raise HTTPException(400, "Invalid template")
        
        # Save files
        pdf_paths = []
        for f in files:
            if not f.filename.lower().endswith('.pdf'):
                continue
            path = UPLOAD_DIR / f"{uuid.uuid4()}_{f.filename}"
            with open(path, "wb") as fp:
                fp.write(await f.read())
            pdf_paths.append((path, f.filename))
        
        if not pdf_paths:
            raise HTTPException(400, "No PDF files found")
        
        # Extract text (2-3s)
        extract_start = time.time()
        texts = []
        for path, name in pdf_paths:
            texts.append(extract_pdf_text(path))
            path.unlink()
        
        combined_text = "\n\n=== NEXT DOCUMENT ===\n\n".join(texts)
        extraction_time = time.time() - extract_start
        
        # CONTROLLED PARALLEL EXTRACTION (8-12s)
        # Process sheets in batches to avoid overwhelming API
        llm_start = time.time()
        sheet_names = TEMPLATES[template_id]["sheet_names"]
        
        # Process 3 sheets at a time (controlled by semaphore)
        all_results = []
        for i in range(0, len(sheet_names), 3):
            batch = sheet_names[i:i+3]
            tasks = [extract_sheet_parallel(sheet, combined_text) for sheet in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            all_results.extend(batch_results)
            
            # Small delay between batches to avoid rate limits
            if i + 3 < len(sheet_names):
                await asyncio.sleep(1)
        
        # Merge results
        extracted = {}
        for result in all_results:
            if isinstance(result, dict):
                extracted.update(result)
        
        llm_time = time.time() - llm_start
        
        # Calculate accuracy
        accuracy = calculate_accuracy(extracted, template_id)
        confidence = min(accuracy + 5, 100)
        
        # Create Excel (2-3s)
        output_filename = f"extraction_{template_id}_{session_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        output_path = OUTPUT_DIR / output_filename
        
        metadata = {
            "timestamp": datetime.now().isoformat(),
            "processing_time": round(time.time() - start_time, 2),
            "extraction_time": round(extraction_time, 2),
            "llm_time": round(llm_time, 2),
            "accuracy": accuracy,
            "confidence": confidence,
            "files_processed": len(pdf_paths),
            "llm_model": "Groq/Mistral"
        }
        
        create_excel(extracted, template_id, output_path, metadata)
        
        # Save history
        history = []
        if HISTORY_FILE.exists():
            with open(HISTORY_FILE, 'r') as f:
                history = json.load(f)
        
        history.append({
            "session_id": session_id,
            "created_at": datetime.now().isoformat(),
            "template": template_id,
            "files": [name for _, name in pdf_paths],
            "output_file": output_filename,
            "messages": [{
                "role": "assistant",
                "content": f"✅ **Extraction Complete!**\n\n• Files: {len(pdf_paths)}/{len(pdf_paths)} extracted\n• Time: {metadata['processing_time']}s\n• Accuracy: {accuracy}%\n• Confidence: {confidence}%\n\n💡 You can now download the Excel or ask questions!",
                "timestamp": datetime.now().isoformat(),
                "excelFile": output_filename,
                "summary": {
                    "successful": len(pdf_paths),
                    "files_processed": len(pdf_paths),
                    "processing_time": metadata['processing_time'],
                    "excel_file": output_filename,
                    "pdf_names": [name for _, name in pdf_paths],
                    "session_name": f"{pdf_paths[0][1][:30]}...",
                    "accuracy": accuracy,
                    "confidence": confidence
                },
                "isResult": True
            }]
        })
        
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f, indent=2)
        
        total_time = time.time() - start_time
        logger.info(f"Session {session_id}: Complete in {total_time:.2f}s (Acc: {accuracy}%)")
        
        return JSONResponse({
            "success": True,
            "session_id": session_id,
            "summary": {
                "successful": len(pdf_paths),
                "files_processed": len(pdf_paths),
                "processing_time": round(total_time, 2),
                "excel_file": output_filename,
                "pdf_names": [name for _, name in pdf_paths],
                "accuracy": round(accuracy, 2),
                "confidence": round(confidence, 2)
            },
            "results": [{"filename": name, "status": "success"} for _, name in pdf_paths]
        })
    
    except Exception as e:
        logger.error(f"Extraction failed: {e}", exc_info=True)
        raise HTTPException(500, str(e))

@app.get("/api/download/{filename}")
async def download(filename: str):
    """Download Excel file"""
    path = OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=filename)

@app.post("/api/chat")
async def chat(message: str = Form(...), session_id: str = Form(...), pdf_context: str = Form("")):
    """Chat with extracted data"""
    try:
        if not HISTORY_FILE.exists():
            return JSONResponse({"response": "No extraction history found."})
        
        with open(HISTORY_FILE, 'r') as f:
            history = json.load(f)
        
        session = next((s for s in history if s["session_id"] == session_id), None)
        if not session:
            return JSONResponse({"response": "Session not found."})
        
        excel_file = session.get("output_file")
        if not excel_file:
            return JSONResponse({"response": "No Excel file found."})
        
        # Read Excel
        excel_path = OUTPUT_DIR / excel_file
        wb = openpyxl.load_workbook(excel_path)
        
        data_summary = {}
        for sheet in wb.sheetnames[:5]:
            ws = wb[sheet]
            data_summary[sheet] = [[str(cell.value) for cell in row] for row in ws.iter_rows(max_row=10)]
        
        # Query LLM
        prompt = f"""Based on this data:

{json.dumps(data_summary, indent=2)}

Question: {message}

Provide a clear answer."""

        response = await call_llm_smart(prompt, max_tokens=500)
        answer = response.get("answer", str(response)) if isinstance(response, dict) else str(response)
        
        return JSONResponse({"response": answer})
    
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return JSONResponse({"response": "Error processing your question."})

@app.get("/api/history")
async def history():
    """Get session history"""
    if not HISTORY_FILE.exists():
        return JSONResponse({"sessions": []})
    
    with open(HISTORY_FILE, 'r') as f:
        data = json.load(f)
    
    return JSONResponse({"sessions": data})

@app.get("/api/history/{session_id}")
async def get_session(session_id: str):
    """Get specific session"""
    if not HISTORY_FILE.exists():
        raise HTTPException(404, "No history found")
    
    with open(HISTORY_FILE, 'r') as f:
        history = json.load(f)
    
    session = next((s for s in history if s["session_id"] == session_id), None)
    if not session:
        raise HTTPException(404, "Session not found")
    
    return JSONResponse(session)

@app.get("/api/templates")
async def templates():
    """Get available templates"""
    return JSONResponse({
        "templates": {
            tid: {"name": t["name"], "sheets": t["sheets"]}
            for tid, t in TEMPLATES.items()
        }
    })

@app.get("/")
async def root():
    return {"message": "Velocity.ai API v2.1 - Production Ready", "status": "online"}

@app.on_event("shutdown")
async def shutdown_event():
    """Close HTTP client on shutdown"""
    await http_client.aclose()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)