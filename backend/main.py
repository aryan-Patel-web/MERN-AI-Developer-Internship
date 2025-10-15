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
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from mistralai import Mistral
from groq import Groq
import os
from dotenv import load_dotenv
import re

load_dotenv()

# Setup
UPLOAD_DIR = Path("uploads"); UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR = Path("outputs"); OUTPUT_DIR.mkdir(exist_ok=True)
TEMPLATE_DIR = Path("templates"); TEMPLATE_DIR.mkdir(exist_ok=True)
HISTORY_FILE = Path("history.json")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("VelocityAI")

app = FastAPI(title="Velocity.ai", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

# PDF Extraction (same as before)
def extract_pdf_text(file_path: Path) -> Dict[str, Any]:
    text = ""
    page_count = 0
    method = "pdfplumber"
    
    try:
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for i, page in enumerate(pdf.pages, 1):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text += f"\n\n═══ PAGE {i} ═══\n{page_text}"
        
        if len(text.strip()) < 150:
            method = "PyPDF2"
            with open(file_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                page_count = len(reader.pages)
                for i, page in enumerate(reader.pages, 1):
                    page_text = page.extract_text() or ""
                    if page_text.strip():
                        text += f"\n\n═══ PAGE {i} ═══\n{page_text}"
        
        return {
            "text": text.strip(),
            "page_count": page_count,
            "method": method,
            "char_count": len(text),
            "success": True
        }
    except Exception as e:
        logger.error(f"PDF extraction failed: {e}")
        return {"text": "", "page_count": 0, "method": "failed", "success": False, "error": str(e)}

# Session Management (same as before)
def load_history():
    if not HISTORY_FILE.exists():
        return []
    try:
        data = json.loads(HISTORY_FILE.read_text() or "[]")
        return data if isinstance(data, list) else []
    except:
        return []

def save_history(data):
    HISTORY_FILE.write_text(json.dumps(data, indent=2))

def add_session_message(session_id: str, message: dict):
    sessions = load_history()
    for s in sessions:
        if s.get("session_id") == session_id:
            s.setdefault("messages", []).append(message)
            save_history(sessions)
            return
    
    sessions.append({
        "session_id": session_id,
        "created_at": datetime.now().isoformat(),
        "messages": [message]
    })
    save_history(sessions)

# TEMPLATE DEFINITIONS
TEMPLATES = {
    "template_1": {
        "name": "Private Equity Fund Data",
        "description": "Extract fund information, portfolio companies, performance metrics",
        "sheets": [
            "Portfolio Summary",
            "Schedule of Investments",
            "Statement of Operations",
            "Statement of Cashflows",
            "PCAP Statement",
            "Portfolio Company Profile",
            "Portfolio Company Financials",
            "Footnotes"
        ]
    },
    "template_2": {
        "name": "Invoice/Report Extraction",
        "description": "Extract invoice details, line items, totals",
        "sheets": ["Invoice Summary", "Line Items", "Payment Details"]
    },
    "template_3": {
        "name": "General Document Extraction",
        "description": "Extract general document fields",
        "sheets": ["Document Summary", "Extracted Fields", "Metadata"]
    }
}

# LLM Service with Template-Specific Prompts
class LLMService:
    def __init__(self):
        self.mistral_key = os.getenv("MISTRAL_API_KEY")
        self.groq_key = os.getenv("GROQ_API_KEY")
        self.mistral = Mistral(api_key=self.mistral_key) if self.mistral_key else None
        self.groq = Groq(api_key=self.groq_key) if self.groq_key else None
        self.max_retries = 3
    
    def _build_template1_prompt(self, text: str, filename: str) -> str:
        """Template 1: Private Equity Fund Data"""
        return f"""You are an elite Private Equity Fund Data Extraction AI with 99.5% accuracy.

DOCUMENT: {filename}

EXTRACT ALL DATA AND ORGANIZE INTO THESE 8 CATEGORIES:

1. PORTFOLIO SUMMARY:
   - General Partner, Fund Name, Fund Currency, Reporting Period
   - Total Commitments, Total Drawdowns, Remaining Commitments
   - Total Distributions, Assets Under Management
   - DPI, RVPI, TVPI, Net IRR, Gross IRR
   - Number of Active Investments, Portfolio Companies, Exits

2. SCHEDULE OF INVESTMENTS (for each company):
   - Company Name, Fund, Reported Date, Investment Status
   - Security Type, Number of Shares, Fund Ownership %
   - Initial Investment Date, Fund Commitment
   - Total Invested, Current Cost, Reported Value, Realized Proceeds
   - LP Ownership %, Final Exit Date, Valuation Policy
   - Unrealized Gains/Losses, Investment Multiple, IRR

3. STATEMENT OF OPERATIONS:
   - Period, Portfolio Interest Income, Portfolio Dividend Income
   - Other Interest Earned, Total Income
   - Management Fees, Broken Deal Fees, Interest, Professional Fees
   - Bank Fees, Advisory Directors' Fees, Insurance, Total Expenses
   - Net Operating Income/Deficit
   - Net Realized/Unrealized Gains on Investments
   - Net Increase in Partners' Capital

4. STATEMENT OF CASHFLOWS:
   - Net increase in partners' capital from operations
   - Net change in unrealized gain/loss
   - Net realized gain/loss
   - Increase/decrease in accounts payable
   - Due from/to affiliates, limited partners, third parties
   - Purchase/sale of investments
   - Capital contributions, Distributions
   - Proceeds/repayment of loans
   - Cash beginning/ending balances

5. PCAP STATEMENT (Partners' Capital):
   - Beginning NAV, Contributions, Distributions
   - Management Fees, Fee Rebates, Partnership Expenses
   - Interest Income, Dividend Income, Other Income/Expense
   - Realized/Unrealized Gains
   - Ending NAV, Incentive Allocations
   - Total Commitment, Unfunded Commitment

6. PORTFOLIO COMPANY PROFILE (for each company):
   - Company Name, Initial Investment Date, Industry, Headquarters
   - Company Description, Fund Ownership %
   - Enterprise Valuation, Securities Held
   - Investment Commitment, Invested Capital, Reported Value
   - Investment Multiple, Gross IRR
   - Investment Thesis, Exit Expectations
   - Recent Events, Company Assessment

7. PORTFOLIO COMPANY FINANCIALS (for each company):
   - Company, Currency, Operating Data Date
   - LTM Revenue (Current/Prior/2 Prior Periods)
   - LTM EBITDA (Current/Prior/2 Prior Periods)
   - Cash, Book Value, Gross Debt
   - Debt Maturity Schedule
   - YOY Growth (Revenue/EBITDA)
   - EBITDA Margin, TEV, Leverage

8. FOOTNOTES:
   - Note #, Note Header, Date, Description

RETURN VALID JSON:
{{
  "portfolio_summary": {{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}},
  "schedule_of_investments": [{{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}}],
  "statement_of_operations": {{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}},
  "statement_of_cashflows": {{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}},
  "pcap_statement": {{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}},
  "portfolio_company_profile": [{{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}}],
  "portfolio_company_financials": [{{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}}],
  "footnotes": [{{"note_number": 1, "header": "", "date": "", "description": ""}}]
}}

DOCUMENT TEXT:
{text}

RETURN ONLY VALID JSON, NO MARKDOWN."""

    def _build_template2_prompt(self, text: str, filename: str) -> str:
        """Template 2: Invoice/Report Extraction"""
        return f"""Extract invoice/report data from this document.

DOCUMENT: {filename}

EXTRACT:
1. INVOICE SUMMARY:
   - Invoice Number, Date, Due Date
   - Vendor Name, Vendor Address, Vendor Tax ID
   - Customer Name, Customer Address, Customer Tax ID
   - Subtotal, Tax Amount, Total Amount
   - Currency, Payment Terms, PO Number

2. LINE ITEMS (each item):
   - Item Description, Quantity, Unit Price
   - Line Total, Tax Rate, Discount

3. PAYMENT DETAILS:
   - Bank Name, Account Number, SWIFT/BIC
   - Payment Method, Payment Status

RETURN JSON:
{{
  "invoice_summary": {{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}},
  "line_items": [{{"description": "", "quantity": 0, "unit_price": 0, "total": 0}}],
  "payment_details": {{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}}
}}

DOCUMENT TEXT:
{text}

RETURN ONLY VALID JSON."""

    def _build_template3_prompt(self, text: str, filename: str) -> str:
        """Template 3: General Document"""
        return f"""Extract all structured data from this document.

DOCUMENT: {filename}

EXTRACT:
1. DOCUMENT SUMMARY:
   - Document Type, Title, Date, Author
   - Organization, Department
   - Subject, Purpose, Status

2. EXTRACTED FIELDS:
   - All key-value pairs found
   - Tables with headers and data
   - Lists and structured content

3. METADATA:
   - Page Count, Language, Format
   - Keywords, Categories, References

RETURN JSON:
{{
  "document_summary": {{"field": {{"value": "", "confidence": 0-100, "source": ""}}, ...}},
  "extracted_fields": [{{"field": "", "value": "", "confidence": 0-100}}],
  "metadata": {{"page_count": 0, "language": "", "keywords": []}}
}}

DOCUMENT TEXT:
{text}

RETURN ONLY VALID JSON."""

    def _get_prompt_for_template(self, template_id: str, text: str, filename: str) -> str:
        """Get appropriate prompt based on template"""
        if template_id == "template_1":
            return self._build_template1_prompt(text, filename)
        elif template_id == "template_2":
            return self._build_template2_prompt(text, filename)
        elif template_id == "template_3":
            return self._build_template3_prompt(text, filename)
        else:
            return self._build_template1_prompt(text, filename)
    
    async def extract_with_mistral(self, text: str, filename: str, template_id: str, retry: int = 0) -> Dict:
        try:
            prompt = self._get_prompt_for_template(template_id, text, filename)
            
            if self.mistral is None:
                raise Exception("Mistral client not initialized")
            
            response = self.mistral.chat.complete(
                model="mistral-large-latest",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=16000,
            )
            
            content = response.choices[0].message.content.strip()
            content = re.sub(r'^```json\s*', '', content)
            content = re.sub(r'^```\s*', '', content)
            content = re.sub(r'\s*```$', '', content)
            
            data = json.loads(content)
            data["_llm_model"] = "mistral-large-latest"
            data["_template"] = template_id
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"Mistral JSON error (retry {retry}): {e}")
            if retry < self.max_retries:
                await asyncio.sleep(2 ** retry)
                return await self.extract_with_mistral(text, filename, template_id, retry + 1)
            raise
        except Exception as e:
            logger.error(f"Mistral error: {e}")
            raise
    
    async def extract_with_groq(self, text: str, filename: str, template_id: str, retry: int = 0) -> Dict:
        try:
            prompt = self._get_prompt_for_template(template_id, text, filename)
            
            response = self.groq.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=8000,
            )
            
            content = response.choices[0].message.content.strip()
            content = re.sub(r'^```json\s*', '', content)
            content = re.sub(r'^```\s*', '', content)
            content = re.sub(r'\s*```$', '', content)
            
            data = json.loads(content)
            data["_llm_model"] = "llama-3.3-70b-versatile"
            data["_template"] = template_id
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"Groq JSON error (retry {retry}): {e}")
            if retry < self.max_retries:
                await asyncio.sleep(2 ** retry)
                return await self.extract_with_groq(text, filename, template_id, retry + 1)
            raise
        except Exception as e:
            logger.error(f"Groq error: {e}")
            raise
    
    async def extract(self, text: str, filename: str, template_id: str = "template_1") -> Dict:
        if self.mistral:
            try:
                logger.info(f"Extracting with Mistral: {filename} (Template: {template_id})")
                return await self.extract_with_mistral(text, filename, template_id)
            except Exception as e:
                logger.warning(f"Mistral failed, trying Groq: {e}")
        
        if self.groq:
            try:
                logger.info(f"Extracting with Groq: {filename} (Template: {template_id})")
                return await self.extract_with_groq(text, filename, template_id)
            except Exception as e:
                logger.error(f"Groq also failed: {e}")
        
        raise HTTPException(500, "All LLM providers failed")

llm_service = LLMService()

# NEW: Template-Specific Excel Generation
def generate_excel_template1(results: List[Dict], output_path: Path):
    """Generate Excel for Template 1: Private Equity Fund"""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    
    # Styles
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    border = Border(left=Side(style='thin'), right=Side(style='thin'), 
                    top=Side(style='thin'), bottom=Side(style='thin'))
    
    for result in results:
        if result.get("status") != "success":
            continue
            
        data = result.get("data", {})
        
        # Sheet 1: Portfolio Summary
        ws1 = wb.create_sheet("Portfolio Summary")
        ws1.append(["Field", "Value", "Confidence", "Source"])
        for col in range(1, 5):
            cell = ws1.cell(1, col)
            cell.font = header_font
            cell.fill = header_fill
        
        portfolio_summary = data.get("portfolio_summary", {})
        for field, details in portfolio_summary.items():
            if isinstance(details, dict):
                ws1.append([
                    field.replace("_", " ").title(),
                    details.get("value", ""),
                    details.get("confidence", 0),
                    details.get("source", "")
                ])
        
        # Sheet 2: Schedule of Investments
        ws2 = wb.create_sheet("Schedule of Investments")
        headers = ["Company", "Fund", "Reported Date", "Status", "Security Type", 
                   "Ownership %", "Investment Date", "Invested Capital", "Reported Value",
                   "Realized Proceeds", "Investment Multiple", "IRR"]
        ws2.append(headers)
        for col in range(1, len(headers) + 1):
            ws2.cell(1, col).font = header_font
            ws2.cell(1, col).fill = header_fill
        
        schedule = data.get("schedule_of_investments", [])
        for inv in schedule:
            row = []
            for header in headers:
                field_key = header.lower().replace(" ", "_").replace("%", "percent")
                if field_key in inv and isinstance(inv[field_key], dict):
                    row.append(inv[field_key].get("value", ""))
                else:
                    row.append("")
            ws2.append(row)
        
        # Sheet 3: Statement of Operations
        ws3 = wb.create_sheet("Statement of Operations")
        ws3.append(["Field", "Value", "Confidence", "Source"])
        for col in range(1, 5):
            ws3.cell(1, col).font = header_font
            ws3.cell(1, col).fill = header_fill
        
        operations = data.get("statement_of_operations", {})
        for field, details in operations.items():
            if isinstance(details, dict):
                ws3.append([
                    field.replace("_", " ").title(),
                    details.get("value", ""),
                    details.get("confidence", 0),
                    details.get("source", "")
                ])
        
        # Sheet 4: Statement of Cashflows
        ws4 = wb.create_sheet("Statement of Cashflows")
        ws4.append(["Field", "Value", "Confidence", "Source"])
        for col in range(1, 5):
            ws4.cell(1, col).font = header_font
            ws4.cell(1, col).fill = header_fill
        
        cashflows = data.get("statement_of_cashflows", {})
        for field, details in cashflows.items():
            if isinstance(details, dict):
                ws4.append([
                    field.replace("_", " ").title(),
                    details.get("value", ""),
                    details.get("confidence", 0),
                    details.get("source", "")
                ])
        
        # Sheet 5: PCAP Statement
        ws5 = wb.create_sheet("PCAP Statement")
        ws5.append(["Field", "Value", "Confidence", "Source"])
        for col in range(1, 5):
            ws5.cell(1, col).font = header_font
            ws5.cell(1, col).fill = header_fill
        
        pcap = data.get("pcap_statement", {})
        for field, details in pcap.items():
            if isinstance(details, dict):
                ws5.append([
                    field.replace("_", " ").title(),
                    details.get("value", ""),
                    details.get("confidence", 0),
                    details.get("source", "")
                ])
        
        # Sheet 6: Portfolio Company Profile
        ws6 = wb.create_sheet("Portfolio Company Profile")
        profile_headers = ["Company Name", "Investment Date", "Industry", "Headquarters",
                           "Description", "Ownership %", "Investment Thesis", "IRR"]
        ws6.append(profile_headers)
        for col in range(1, len(profile_headers) + 1):
            ws6.cell(1, col).font = header_font
            ws6.cell(1, col).fill = header_fill
        
        profiles = data.get("portfolio_company_profile", [])
        for prof in profiles:
            row = []
            for header in profile_headers:
                field_key = header.lower().replace(" ", "_").replace("%", "percent")
                if field_key in prof and isinstance(prof[field_key], dict):
                    row.append(prof[field_key].get("value", ""))
                else:
                    row.append("")
            ws6.append(row)
        
        # Sheet 7: Portfolio Company Financials
        ws7 = wb.create_sheet("Portfolio Company Financials")
        fin_headers = ["Company", "Currency", "Date", "LTM Revenue", "LTM EBITDA",
                       "Revenue Growth %", "EBITDA Margin %", "Debt", "Leverage"]
        ws7.append(fin_headers)
        for col in range(1, len(fin_headers) + 1):
            ws7.cell(1, col).font = header_font
            ws7.cell(1, col).fill = header_fill
        
        financials = data.get("portfolio_company_financials", [])
        for fin in financials:
            row = []
            for header in fin_headers:
                field_key = header.lower().replace(" ", "_").replace("%", "percent")
                if field_key in fin and isinstance(fin[field_key], dict):
                    row.append(fin[field_key].get("value", ""))
                else:
                    row.append("")
            ws7.append(row)
        
        # Sheet 8: Footnotes
        ws8 = wb.create_sheet("Footnotes")
        ws8.append(["Note #", "Header", "Date", "Description"])
        for col in range(1, 5):
            ws8.cell(1, col).font = header_font
            ws8.cell(1, col).fill = header_fill
        
        footnotes = data.get("footnotes", [])
        for note in footnotes:
            ws8.append([
                note.get("note_number", ""),
                note.get("header", ""),
                note.get("date", ""),
                note.get("description", "")
            ])
    
    # Auto-adjust columns
    for ws in wb.worksheets:
        for column in ws.columns:
            max_length = 0
            column_letter = get_column_letter(column[0].column)
            for cell in column:
                try:
                    if cell.value and len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            ws.column_dimensions[column_letter].width = min(max_length + 3, 60)
    
    wb.save(output_path)
    logger.info(f"Template 1 Excel saved: {output_path}")

def generate_excel_template2(results: List[Dict], output_path: Path):
    """Generate Excel for Template 2: Invoice/Report"""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    
    for result in results:
        if result.get("status") != "success":
            continue
            
        data = result.get("data", {})
        
        # Sheet 1: Invoice Summary
        ws1 = wb.create_sheet("Invoice Summary")
        ws1.append(["Field", "Value"])
        ws1.cell(1, 1).font = header_font
        ws1.cell(1, 2).font = header_font
        ws1.cell(1, 1).fill = header_fill
        ws1.cell(1, 2).fill = header_fill
        
        summary = data.get("invoice_summary", {})
        for field, details in summary.items():
            if isinstance(details, dict):
                ws1.append([field.replace("_", " ").title(), details.get("value", "")])
        
        # Sheet 2: Line Items
        ws2 = wb.create_sheet("Line Items")
        headers = ["Description", "Quantity", "Unit Price", "Line Total", "Tax Rate", "Discount"]
        ws2.append(headers)
        for col in range(1, len(headers) + 1):
            ws2.cell(1, col).font = header_font
            ws2.cell(1, col).fill = header_fill
        
        items = data.get("line_items", [])
        for item in items:
            ws2.append([
                item.get("description", ""),
                item.get("quantity", 0),
                item.get("unit_price", 0),
                item.get("total", 0),
                item.get("tax_rate", 0),
                item.get("discount", 0)
            ])
        
        # Sheet 3: Payment Details
        ws3 = wb.create_sheet("Payment Details")
        ws3.append(["Field", "Value"])
        ws3.cell(1, 1).font = header_font
        ws3.cell(1, 2).font = header_font
        ws3.cell(1, 1).fill = header_fill
        ws3.cell(1, 2).fill = header_fill
        
        payment = data.get("payment_details", {})
        for field, details in payment.items():
            if isinstance(details, dict):
                ws3.append([field.replace("_", " ").title(), details.get("value", "")])
    
    wb.save(output_path)
    logger.info(f"Template 2 Excel saved: {output_path}")

def generate_excel_template3(results: List[Dict], output_path: Path):
    """Generate Excel for Template 3: General Document"""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    
    for result in results:
        if result.get("status") != "success":
            continue
            
        data = result.get("data", {})
        
        # Sheet 1: Document Summary
        ws1 = wb.create_sheet("Document Summary")
        ws1.append(["Field", "Value"])
        ws1.cell(1, 1).font = header_font
        ws1.cell(1, 2).font = header_font
        ws1.cell(1, 1).fill = header_fill
        ws1.cell(1, 2).fill = header_fill
        
        summary = data.get("document_summary", {})
        for field, details in summary.items():
            if isinstance(details, dict):
                ws1.append([field.replace("_", " ").title(), details.get("value", "")])
        
        # Sheet 2: Extracted Fields
        ws2 = wb.create_sheet("Extracted Fields")
        ws2.append(["Field", "Value", "Confidence"])
        for col in range(1, 4):
            ws2.cell(1, col).font = header_font
            ws2.cell(1, col).fill = header_fill
        
        fields = data.get("extracted_fields", [])
        for field in fields:
            ws2.append([
                field.get("field", ""),
                field.get("value", ""),
                field.get("confidence", 0)
            ])
        
        # Sheet 3: Metadata
        ws3 = wb.create_sheet("Metadata")
        ws3.append(["Field", "Value"])
        ws3.cell(1, 1).font = header_font
        ws3.cell(1, 2).font = header_font
        ws3.cell(1, 1).fill = header_fill
        ws3.cell(1, 2).fill = header_fill
        
        metadata = data.get("metadata", {})
        for field, value in metadata.items():
            ws3.append([field.replace("_", " ").title(), str(value)])
    
    wb.save(output_path)
    logger.info(f"Template 3 Excel saved: {output_path}")

def generate_excel(results: List[Dict], output_path: Path, template_id: str = "template_1"):
    """Route to appropriate Excel generator based on template"""
    if template_id == "template_1":
        generate_excel_template1(results, output_path)
    elif template_id == "template_2":
        generate_excel_template2(results, output_path)
    elif template_id == "template_3":
        generate_excel_template3(results, output_path)
    else:
        generate_excel_template1(results, output_path)

# Process File with Template
async def process_file(file: UploadFile, template_id: str = "template_1") -> Dict:
    job_id = str(uuid.uuid4())[:8]
    file_path = UPLOAD_DIR / f"{job_id}_{file.filename}"  
    try:
        content = await file.read()
        file_path.write_bytes(content)
        
        # Extract text
        extraction = extract_pdf_text(file_path)
        if not extraction["success"]:
            return {
                "filename": file.filename,
                "status": "error",
                "error": extraction.get("error", "PDF extraction failed"),
                "data": {}
            }
        
        # Extract with LLM using specified template
        text = extraction["text"]
        data = await llm_service.extract(text, file.filename, template_id)
        
        # Calculate stats
        total_fields = 0
        total_conf = 0
        
        # Count fields based on template structure
        if template_id == "template_1":
            for section in ["portfolio_summary", "statement_of_operations", "statement_of_cashflows", "pcap_statement"]:
                if section in data:
                    for field, details in data[section].items():
                        if isinstance(details, dict) and "confidence" in details:
                            total_fields += 1
                            total_conf += details.get("confidence", 0)
            
            for section in ["schedule_of_investments", "portfolio_company_profile", "portfolio_company_financials"]:
                if section in data:
                    total_fields += len(data[section])
                    for item in data[section]:
                        if isinstance(item, dict):
                            for field, details in item.items():
                                if isinstance(details, dict) and "confidence" in details:
                                    total_conf += details.get("confidence", 0)
        
        elif template_id == "template_2":
            for section in ["invoice_summary", "payment_details"]:
                if section in data:
                    for field, details in data[section].items():
                        if isinstance(details, dict) and "confidence" in details:
                            total_fields += 1
                            total_conf += details.get("confidence", 0)
            
            if "line_items" in data:
                total_fields += len(data["line_items"])
        
        elif template_id == "template_3":
            if "document_summary" in data:
                for field, details in data["document_summary"].items():
                    if isinstance(details, dict) and "confidence" in details:
                        total_fields += 1
                        total_conf += details.get("confidence", 0)
            
            if "extracted_fields" in data:
                total_fields += len(data["extracted_fields"])
                for field in data["extracted_fields"]:
                    if isinstance(field, dict) and "confidence" in field:
                        total_conf += field.get("confidence", 0)
        
        avg_conf = round(total_conf / total_fields, 1) if total_fields else 0
        
        if "metadata" not in data:
            data["metadata"] = {}
        data["metadata"]["total_fields_extracted"] = total_fields
        data["metadata"]["average_confidence"] = avg_conf
        data["metadata"]["template_used"] = template_id
        
        logger.info(f"✓ {file.filename}: {total_fields} fields, {avg_conf}% confidence (Template: {template_id})")
        
        return {
            "filename": file.filename,
            "status": "success",
            "data": data,
            "extraction_info": extraction,
            "llm_model": data.get("_llm_model", "unknown"),
            "template_id": template_id
        }
        
    except Exception as e:
        logger.error(f"Error processing {file.filename}: {e}")
        return {
            "filename": file.filename,
            "status": "error",
            "error": str(e),
            "data": {},
            "template_id": template_id
        }

# API Endpoints
@app.post("/api/extract")
async def extract_endpoint(
    files: List[UploadFile] = File(...),
    template_id: str = Form("template_1"),
    session_id: str = Form(...)
):
    """Main extraction endpoint with template support"""
    logger.info(f"Processing {len(files)} files for session {session_id} with template {template_id}")
    
    # Validate template
    if template_id not in TEMPLATES:
        raise HTTPException(400, f"Invalid template_id: {template_id}")
    
    tasks = [process_file(f, template_id) for f in files]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    final_results = []
    for r in results:
        if isinstance(r, Exception):
            final_results.append({"status": "error", "error": str(r), "filename": "unknown", "template_id": template_id})
        else:
            final_results.append(r)
    
    # Generate Excel with template-specific formatting
    excel_filename = f"extraction_{template_id}_{session_id[:8]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    excel_path = OUTPUT_DIR / excel_filename
    generate_excel(final_results, excel_path, template_id)
    
    # Stats
    successful = [r for r in final_results if r.get("status") == "success"]
    total_fields = sum(r.get("data", {}).get("metadata", {}).get("total_fields_extracted", 0) for r in successful)
    avg_conf = sum(r.get("data", {}).get("metadata", {}).get("average_confidence", 0) for r in successful) / max(len(successful), 1)
    
    summary = {
        "files_processed": len(files),
        "successful": len(successful),
        "failed": len(final_results) - len(successful),
        "total_fields_extracted": total_fields,
        "average_confidence": round(avg_conf, 1),
        "excel_file": excel_filename,
        "template_used": template_id,
        "template_name": TEMPLATES[template_id]["name"]
    }
    
    # Save to history
    msg = {
        "role": "assistant",
        "content": f"Extraction completed: {summary['successful']}/{summary['files_processed']} files successful (Template: {TEMPLATES[template_id]['name']})",
        "timestamp": datetime.now().isoformat(),
        "summary": summary,
        "results": final_results
    }
    add_session_message(session_id, msg)
    
    return {"summary": summary, "results": final_results, "excel_file": excel_filename}

@app.get("/api/templates")
async def get_templates():
    """Get available extraction templates"""
    return {"templates": TEMPLATES}

@app.get("/api/download/{filename}")
async def download(filename: str):
    """Download Excel file"""
    file_path = OUTPUT_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, f"File not found: {filename}")
    return FileResponse(
        path=file_path,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename=filename
    )

@app.get("/api/history")
def get_history():
    """Get all sessions"""
    return {"sessions": load_history()}

@app.get("/api/history/{session_id}")
def get_session(session_id: str):
    """Get specific session"""
    for s in load_history():
        if s.get("session_id") == session_id:
            return {"messages": s.get("messages", [])}
    return {"messages": []}

@app.get("/api/health")
async def health():
    """Health check"""
    return {
        "status": "healthy",
        "service": "Velocity.ai",
        "version": "3.0.0",
        "llm_providers": {
            "mistral": llm_service.mistral is not None,
            "groq": llm_service.groq is not None
        },
        "templates": list(TEMPLATES.keys())
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")