from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import pdfplumber
import PyPDF2
import json
import uuid
import logging
import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from mistralai.client import MistralClient
from mistralai.models.chat_completion import ChatMessage

from groq import Groq
import os
from dotenv import load_dotenv
import re


from pathlib import Path

env_path = Path("D:/MERN + AI + Internship/backend/.env")
load_dotenv(dotenv_path=env_path)

print("Mistral API Key:", os.getenv("MISTRAL_API_KEY"))
print("Groq API Key:", os.getenv("GROQ_API_KEY"))

# Load environment variables
load_dotenv()

# =========================
# Config & Paths
# =========================
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)
TEMPLATE_DIR = Path("templates")
TEMPLATE_DIR.mkdir(exist_ok=True)
HISTORY_DIR = Path("history")
HISTORY_DIR.mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("VelocityAI")
# =========================
# FastAPI App
# =========================
app = FastAPI(title="Velocity.ai - PDF Extraction Tool", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# PDF Extraction
# =========================
# def extract_pdf_text(file_path: Path) -> Dict[str, Any]:
#     """Extract text from PDF with metadata"""
#     text = ""
#     page_count = 0
#     extraction_method = "pdfplumber"
    
#     try:
#         with pdfplumber.open(file_path) as pdf:
#             page_count = len(pdf.pages)
#             for i, page in enumerate(pdf.pages, 1):
#                 page_text = page.extract_text() or ""
#                 if page_text.strip():
#                     text += f"\n=== Page {i} ===\n{page_text}"
        
#         # Fallback to PyPDF2 if text is too short
#         if len(text.strip()) < 100:
#             extraction_method = "PyPDF2"
#             with open(file_path, 'rb') as f:
#                 reader = PyPDF2.PdfReader(f)
#                 page_count = len(reader.pages)
#                 text = "\n".join([p.extract_text() or "" for p in reader.pages])
        
#         return {
#             "text": text.strip(),
#             "page_count": page_count,
#             "extraction_method": extraction_method,
#             "success": True,
#             "char_count": len(text)
#         }
#     except Exception as e:
#         logger.error(f"PDF extraction failed: {e}")
#         return {
#             "text": "",
#             "page_count": 0,
#             "extraction_method": "failed",
#             "success": False,
#             "error": str(e)
#         }

def extract_pdf_text(file_path: Path) -> Dict[str, Any]:
    """Extract text from PDF with OCR fallback."""
    text = ""
    page_count = 0
    extraction_method = "pdfplumber"

    try:
        # Try pdfplumber first
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for i, page in enumerate(pdf.pages, 1):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text += f"\n=== Page {i} ===\n{page_text}"

        # Fallback to PyPDF2 if text is too short
        if len(text.strip()) < 100:
            extraction_method = "PyPDF2"
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                page_count = len(reader.pages)
                text = "\n".join([p.extract_text() or "" for p in reader.pages])

        # Fallback to OCR if still too short (likely scanned PDF)
        if len(text.strip()) < 100:
            extraction_method = "OCR"
            text = ocr_pdf(file_path)
            page_count = len(text.split("=== Page")) if text else 0

        success = bool(text.strip())
        return {
            "text": text.strip(),
            "page_count": page_count,
            "extraction_method": extraction_method,
            "success": success,
            "char_count": len(text)
        }

    except Exception as e:
        logger.error(f"PDF extraction failed: {e}")
        return {
            "text": "",
            "page_count": 0,
            "extraction_method": "failed",
            "success": False,
            "error": str(e)
        }

from PyPDF2 import PdfReader

def is_scanned_pdf(file_path: Path) -> bool:
    """Return True if PDF has very little text (likely scanned)"""
    try:
        reader = PdfReader(str(file_path))
        total_text = ""
        for page in reader.pages:
            total_text += page.extract_text() or ""
        return len(total_text.strip()) < 50
    except:
        return True



from pdf2image import convert_from_path
import pytesseract

def ocr_pdf(file_path: Path) -> str:
    """Perform OCR on image-based PDF and return text."""
    try:
        pages = convert_from_path(file_path)
        text = ""
        for i, page in enumerate(pages, 1):
            page_text = pytesseract.image_to_string(page)
            if page_text.strip():
                text += f"\n=== Page {i} ===\n{page_text}"
        return text
    except Exception as e:
        logger.error(f"OCR failed: {e}")
        return ""


# =========================
# LLM Service with Retry Logic
# =========================




class LLMService:
    def __init__(self):
        self.mistral_api_key = os.getenv("MISTRAL_API_KEY")
        self.groq_api_key = os.getenv("GROQ_API_KEY")

        if not self.mistral_api_key:
            logger.warning("MISTRAL_API_KEY not found in environment")
        if not self.groq_api_key:
            logger.warning("GROQ_API_KEY not found in environment")

        # Initialize Mistral safely
        self.mistral = MistralClient(api_key=self.mistral_api_key) if self.mistral_api_key else None

        # Initialize Groq safely (latest SDK)
        if self.groq_api_key:
            try:
                self.groq = Groq(api_key=self.groq_api_key)
                logger.info("Groq client initialized successfully")
            except TypeError as e:
                logger.error(f"Failed to initialize Groq: {e}")
                self.groq = None
        else:
            self.groq = None

        self.max_retries = 3
        self.templates = self._load_templates()

    def _load_templates(self) -> Dict[str, Dict]:
        """Load all extraction templates"""
        templates = {}
        template_file = TEMPLATE_DIR / "extraction_template_1.json"

        # Create default template if not exists
        if not template_file.exists():
            default_template = {
                "name": "Private Equity Fund Template",
                "description": "Extract comprehensive private equity fund data",
                "fields": {
                    "fund_info": ["General Partner", "Fund Name", "Fund Currency", "Total Commitments",
                                  "Total Drawdowns", "Remaining Commitments", "Total Distributions"],
                    "performance": ["DPI", "RVPI", "TVPI", "Net IRR", "Gross IRR"],
                    "portfolio": ["Number of Investments", "Active Portfolio Companies"],
                    "companies": ["Company Name", "Investment Date", "Industry", "Invested Capital",
                                  "Ownership %", "Current Value", "Status"]
                }
            }
            with open(template_file, 'w') as f:
                json.dump(default_template, f, indent=2)

        try:
            with open(template_file, 'r') as f:
                templates["extraction_template_1"] = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load template: {e}")

        return templates

    def _create_extraction_prompt(self, text: str, template: Dict) -> str:
        """Create detailed extraction prompt"""
        prompt = f"""You are an expert financial data extraction AI specializing in Private Equity fund documents.

DOCUMENT TEXT:
{text[:25000]}

EXTRACTION TEMPLATE:
{json.dumps(template, indent=2)}

INSTRUCTIONS:
1. Extract ALL relevant financial data from the document
2. Follow the template structure exactly
3. For each field, provide:
   - extracted_value: The actual value found
   - confidence: Your confidence score (0.0 to 1.0)
   - source_page: Page number where found
   - notes: Any relevant context

4. Key data points to extract:
   - Fund identification (GP name, fund name, currency)
   - Financial metrics (commitments, drawdowns, distributions)
   - Performance metrics (DPI, RVPI, TVPI, IRR)
   - Portfolio companies (names, investments, valuations)
   - Dates and timestamps
   - Geographic and industry breakdowns

5. Handle multiple portfolio companies by creating an array
6. Convert all monetary values to numbers (remove currency symbols, commas)
7. Extract percentages as decimals (e.g., 25% as 0.25)
8. If a field is not found, set value to null and confidence to 0.0

OUTPUT FORMAT (strict JSON):
{{
  "fund_overview": {{}},
  "financial_summary": {{}},
  "performance_metrics": {{}},
  "portfolio_companies": [],
  "metadata": {{
    "extraction_date": "{datetime.now().isoformat()}",
    "total_fields_extracted": 0,
    "average_confidence": 0.0
  }}
}}

Return ONLY valid JSON, no additional text."""
        return prompt






    async def extract_with_mistral(self, text: str, template: Dict, retry: int = 0) -> Dict:
        """Extract data using Mistral"""
        if not self.mistral:
            raise HTTPException(500, "Mistral provider is not configured")
        try:
            prompt = self._create_extraction_prompt(text, template)
            
            response = self.mistral.chat(
                model="mistral-large-latest",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=4000,
            )
            
            content = response.choices[0].message.content
            
            # Clean JSON response
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            
            data = json.loads(content)
            data["_llm_model"] = "mistral-large-latest"
            data["_retry_count"] = retry
            
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"Mistral JSON decode error (attempt {retry + 1}): {e}")
            if retry < self.max_retries:
                await asyncio.sleep(2 ** retry)
                return await self.extract_with_mistral(text, template, retry + 1)
            raise
        except Exception as e:
            logger.error(f"Mistral extraction error: {e}")
            raise

    async def extract_with_groq(self, text: str, template: Dict, retry: int = 0) -> Dict:
        """Extract data using Groq (fallback)"""
        try:
            prompt = self._create_extraction_prompt(text, template)
            
            response = self.groq.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=4000,
            )
            
            content = response.choices[0].message.content
            
            # Clean JSON response
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            
            data = json.loads(content)
            data["_llm_model"] = "llama-3.3-70b-versatile"
            data["_retry_count"] = retry
            
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"Groq JSON decode error (attempt {retry + 1}): {e}")
            if retry < self.max_retries:
                await asyncio.sleep(2 ** retry)
                return await self.extract_with_groq(text, template, retry + 1)
            raise
        except Exception as e:
            logger.error(f"Groq extraction error: {e}")
            raise

    async def extract(self, text: str, template_id: str) -> Dict:
        """Main extraction with fallback logic"""
        template = self.templates.get(template_id, {})
        
        # Try Mistral first
        if self.mistral:
            try:
                logger.info("Attempting extraction with Mistral...")
                result = await self.extract_with_mistral(text, template)
                logger.info("✓ Mistral extraction successful")
                return result
            except Exception as e:
                logger.warning(f"Mistral failed: {e}, falling back to Groq...")
        
        # Fallback to Groq
        if self.groq:
            try:
                logger.info("Attempting extraction with Groq...")
                result = await self.extract_with_groq(text, template)
                logger.info("✓ Groq extraction successful")
                return result
            except Exception as e:
                logger.error(f"Groq also failed: {e}")
                raise HTTPException(500, "All LLM providers failed")
        
        raise HTTPException(500, "No LLM providers configured")

llm_service = LLMService()

# =========================
# Excel Generation
# =========================
def generate_excel(data_list: List[Dict], output_path: Path, template_name: str):
    """Generate comprehensive Excel workbook"""
    wb = Workbook()
    wb.remove(wb.active)
    
    # Styles
    header_font = Font(bold=True, color="FFFFFF", size=12)
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    border = Border(
        left=Side(style='thin'),
        right=Side(style='thin'),
        top=Side(style='thin'),
        bottom=Side(style='thin')
    )
    
    # Sheet 1: Executive Summary
    ws_summary = wb.create_sheet("Executive Summary")
    ws_summary.append(["Velocity.ai - Fund Data Extraction Report"])
    ws_summary.append([f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"])
    ws_summary.append([f"Template: {template_name}"])
    ws_summary.append([f"Total Files Processed: {len(data_list)}"])
    ws_summary.append([])
    
    # Sheet 2: Fund Overview
    ws_fund = wb.create_sheet("Fund Overview")
    fund_headers = ["File Name", "General Partner", "Fund Name", "Currency", "Total Commitments", 
                    "Total Drawdowns", "Remaining Commitments", "Total Distributions", "Confidence"]
    ws_fund.append(fund_headers)
    
    for col in range(1, len(fund_headers) + 1):
        cell = ws_fund.cell(1, col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')
    
    # Sheet 3: Performance Metrics
    ws_perf = wb.create_sheet("Performance Metrics")
    perf_headers = ["File Name", "DPI", "RVPI", "TVPI", "Net IRR", "Gross IRR", 
                    "Investment Return", "Avg Confidence"]
    ws_perf.append(perf_headers)
    
    for col in range(1, len(perf_headers) + 1):
        cell = ws_perf.cell(1, col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')
    
    # Sheet 4: Portfolio Companies
    ws_portfolio = wb.create_sheet("Portfolio Companies")
    portfolio_headers = ["Source File", "Company Name", "Investment Date", "Industry", 
                        "Invested Capital", "Ownership %", "Current Value", "Status", "Confidence"]
    ws_portfolio.append(portfolio_headers)
    
    for col in range(1, len(portfolio_headers) + 1):
        cell = ws_portfolio.cell(1, col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')
    
    # Sheet 5: Raw Extraction Data
    ws_raw = wb.create_sheet("Raw Extraction Data")
    raw_headers = ["Filename", "Field", "Value", "Confidence", "Source Page", "Notes"]
    ws_raw.append(raw_headers)
    
    for col in range(1, len(raw_headers) + 1):
        cell = ws_raw.cell(1, col)
        cell.font = header_font
        cell.fill = header_fill
    
    # Populate data
    for item in data_list:
        filename = item["filename"]
        extracted = item.get("data", {})
        
        # Fund Overview
        fund_overview = extracted.get("fund_overview", {})
        ws_fund.append([
            filename,
            fund_overview.get("general_partner", {}).get("value", ""),
            fund_overview.get("fund_name", {}).get("value", ""),
            fund_overview.get("fund_currency", {}).get("value", ""),
            fund_overview.get("total_commitments", {}).get("value", ""),
            fund_overview.get("total_drawdowns", {}).get("value", ""),
            fund_overview.get("remaining_commitments", {}).get("value", ""),
            fund_overview.get("total_distributions", {}).get("value", ""),
            extracted.get("metadata", {}).get("average_confidence", "")
        ])
        
        # Performance Metrics
        perf_metrics = extracted.get("performance_metrics", {})
        ws_perf.append([
            filename,
            perf_metrics.get("dpi", {}).get("value", ""),
            perf_metrics.get("rvpi", {}).get("value", ""),
            perf_metrics.get("tvpi", {}).get("value", ""),
            perf_metrics.get("net_irr", {}).get("value", ""),
            perf_metrics.get("gross_irr", {}).get("value", ""),
            perf_metrics.get("investment_return", {}).get("value", ""),
            extracted.get("metadata", {}).get("average_confidence", "")
        ])
        
        # Portfolio Companies
        companies = extracted.get("portfolio_companies", [])
        for company in companies:
            ws_portfolio.append([
                filename,
                company.get("company_name", {}).get("value", ""),
                company.get("investment_date", {}).get("value", ""),
                company.get("industry", {}).get("value", ""),
                company.get("invested_capital", {}).get("value", ""),
                company.get("ownership", {}).get("value", ""),
                company.get("current_value", {}).get("value", ""),
                company.get("status", {}).get("value", ""),
                company.get("company_name", {}).get("confidence", "")
            ])
        
        # Raw data - flatten all fields
        def flatten_data(data, prefix=""):
            for key, value in data.items():
                if isinstance(value, dict) and "value" in value:
                    ws_raw.append([
                        filename,
                        f"{prefix}{key}",
                        value.get("value", ""),
                        value.get("confidence", ""),
                        value.get("source", ""),
                        value.get("notes", "")
                    ])
                elif isinstance(value, dict):
                    flatten_data(value, f"{prefix}{key}.")
                elif isinstance(value, list):
                    for i, item in enumerate(value):
                        if isinstance(item, dict):
                            flatten_data(item, f"{prefix}{key}[{i}].")
        
        flatten_data(extracted)
    
    # Auto-adjust column widths
    for ws in wb.worksheets:
        for column in ws.columns:
            max_length = 0
            column_letter = get_column_letter(column[0].column)
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)
            ws.column_dimensions[column_letter].width = adjusted_width
    
    wb.save(output_path)
    logger.info(f"Excel file generated: {output_path}")

# =========================
# Chat History Management
# =========================
def save_chat_history(session_id: str, messages: List[Dict]):
    """Save chat history to file"""
    history_file = HISTORY_DIR / f"{session_id}.json"
    with open(history_file, 'w') as f:
        json.dump({
            "session_id": session_id,
            "created_at": datetime.now().isoformat(),
            "messages": messages
        }, f, indent=2)

def load_chat_history(session_id: str) -> List[Dict]:
    """Load chat history from file"""
    history_file = HISTORY_DIR / f"{session_id}.json"
    if history_file.exists():
        with open(history_file, 'r') as f:
            data = json.load(f)
            return data.get("messages", [])
    return []

# =========================
# API Endpoints
# =========================
@app.post("/api/extract")
async def extract(
    files: List[UploadFile] = File(...),
    template_id: str = Form("extraction_template_1"),
    session_id: Optional[str] = Form(None)
):
    if not session_id:
        session_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    results = []

    logger.info(f"Starting extraction job {job_id} for {len(files)} files")

    for file in files:
        try:
            file_path = UPLOAD_DIR / f"{job_id}_{file.filename}"
            content = await file.read()
            file_path.write_bytes(content)

            # Detect scanned PDF
            if is_scanned_pdf(file_path):
                logger.info(f"{file.filename} detected as scanned PDF, using OCR")
                text = ocr_pdf(file_path)
                extraction_method = "OCR"
            else:
                extraction_result = extract_pdf_text(file_path)
                if not extraction_result["success"]:
                    raise Exception(extraction_result.get("error", "Unknown extraction error"))
                text = extraction_result["text"]
                extraction_method = extraction_result.get("extraction_method", "pdfplumber")

            # LLM Extraction
            data = await llm_service.extract(text, template_id)

            # Count fields & average confidence
            total_fields, total_confidence = 0, 0
            def count_fields(obj):
                nonlocal total_fields, total_confidence
                if isinstance(obj, dict):
                    if "value" in obj and "confidence" in obj:
                        total_fields += 1
                        total_confidence += obj.get("confidence", 0)
                    else:
                        for v in obj.values():
                            count_fields(v)
                elif isinstance(obj, list):
                    for item in obj:
                        count_fields(item)
            count_fields(data)
            avg_confidence = total_confidence / total_fields if total_fields else 0
            data.setdefault("metadata", {})
            data["metadata"]["total_fields_extracted"] = total_fields
            data["metadata"]["average_confidence"] = round(avg_confidence, 3)

            results.append({
                "filename": file.filename,
                "status": "success",
                "data": data,
                "extraction_info": {"method": extraction_method, "char_count": len(text)},
                "llm_model": data.get("_llm_model", "unknown")
            })
            logger.info(f"Processed {file.filename}: {total_fields} fields, avg confidence {avg_confidence:.2%}")

        except Exception as e:
            logger.error(f"Error processing {file.filename}: {e}")
            results.append({"filename": file.filename, "status": "error", "error": str(e), "data": {}})

    # Generate Excel
    excel_filename = f"{job_id}_extraction.xlsx"
    excel_path = OUTPUT_DIR / excel_filename
    generate_excel(results, excel_path, template_id)

    # Save session
    save_chat_history(session_id, results)

    return {
        "session_id": session_id,
        "job_id": job_id,
        "files_processed": len(files),
        "results": results,
        "output_file": excel_filename,
        "download_url": f"/api/download/{excel_filename}"
    }


@app.get("/api/test_llm")
async def test_llm():
    try:
        resp = await llm_service.extract("Test text", "extraction_template_1")
        return {"success": True, "response": resp}
    except Exception as e:
        return {"success": False, "error": str(e)}




@app.get("/api/download/{filename}")
def download(filename: str):
    """Download generated Excel file"""
    file_path = OUTPUT_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename
    )

@app.get("/api/history")
def get_history():
    """Get all chat sessions"""
    sessions = []
    for history_file in HISTORY_DIR.glob("*.json"):
        try:
            with open(history_file, 'r') as f:
                data = json.load(f)
                sessions.append({
                    "session_id": data["session_id"],
                    "created_at": data["created_at"],
                    "message_count": len(data["messages"])
                })
        except:
            pass
    return {"sessions": sorted(sessions, key=lambda x: x["created_at"], reverse=True)}

@app.get("/api/history/{session_id}")
def get_session(session_id: str):
    """Get specific chat session"""
    messages = load_chat_history(session_id)
    return {"session_id": session_id, "messages": messages}

@app.post("/api/chat")
async def chat(message: str = Form(...), session_id: str = Form(...)):
    """General chat endpoint"""
    # Simple Q&A about extractions
    response = {
        "session_id": session_id,
        "response": f"I'm Velocity.ai, your PDF extraction assistant. I can help you extract structured data from Private Equity fund documents. Upload PDFs to get started!",
        "timestamp": datetime.now().isoformat()
    }
    return response

@app.get("/api/health")
async def health():
    """Health check"""
    return {
        "status": "healthy",
        "service": "Velocity.ai",
        "version": "1.0.0",
        "llm_providers": {
            "mistral": llm_service.mistral is not None,
            "groq": llm_service.groq is not None
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)