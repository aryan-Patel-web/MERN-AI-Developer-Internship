import logging
from typing import Optional, List, Dict
import pdfplumber
import PyPDF2
from pathlib import Path
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PDFExtractor:
    """
    Service for extracting text from PDF files with multiple fallback strategies.
    """

    def __init__(self):
        self.supported_formats = ['.pdf']

    def extract_text(self, pdf_path: str) -> str:
        path = Path(pdf_path)
        if not path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        if path.suffix.lower() not in self.supported_formats:
            raise ValueError(f"Unsupported file format: {path.suffix}")

        logger.info(f"Extracting text from: {pdf_path}")

        # Try pdfplumber first
        text = self._extract_with_pdfplumber(pdf_path)

        # Fallback to PyPDF2
        if not text or len(text.strip()) < 50:
            logger.info("Falling back to PyPDF2 extraction")
            text = self._extract_with_pypdf2(pdf_path)

        if not text or len(text.strip()) < 50:
            raise ValueError("Could not extract sufficient text from PDF")

        text = self._clean_text(text)
        logger.info(f"Extracted {len(text)} characters from PDF")
        return text

    def _extract_with_pdfplumber(self, pdf_path: str) -> Optional[str]:
        try:
            text_parts = []
            with pdfplumber.open(pdf_path) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            text_parts.append(f"\n--- Page {page_num} ---\n")
                            text_parts.append(page_text)
                        tables = page.extract_tables()
                        if tables:
                            for table_idx, table in enumerate(tables, 1):
                                text_parts.append(f"\n[Table {table_idx}]\n")
                                text_parts.append(self._format_table(table))
                    except Exception as e:
                        logger.warning(f"Error extracting page {page_num}: {e}")
                        continue
            return "\n".join(text_parts)
        except Exception as e:
            logger.error(f"pdfplumber extraction failed: {e}")
            return None

    def _extract_with_pypdf2(self, pdf_path: str) -> Optional[str]:
        try:
            text_parts = []
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page_num, page in enumerate(pdf_reader.pages, 1):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            text_parts.append(f"\n--- Page {page_num} ---\n")
                            text_parts.append(page_text)
                    except Exception as e:
                        logger.warning(f"Error extracting page {page_num}: {e}")
                        continue
            return "\n".join(text_parts)
        except Exception as e:
            logger.error(f"PyPDF2 extraction failed: {e}")
            return None

    def _format_table(self, table: List[List]) -> str:
        if not table:
            return ""
        formatted_rows = []
        for row in table:
            if row:
                cells = [str(cell).strip() if cell else "" for cell in row]
                formatted_rows.append(" | ".join(cells))
        return "\n".join(formatted_rows)

    def _clean_text(self, text: str) -> str:
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        text = "\n".join(lines)
        text = re.sub(r' +', ' ', text)
        return text

    def get_page_count(self, pdf_path: str) -> int:
        try:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                return len(pdf_reader.pages)
        except Exception as e:
            logger.error(f"Error getting page count: {e}")
            return 0

    def extract_metadata(self, pdf_path: str) -> Dict:
        try:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                metadata = pdf_reader.metadata
                return {
                    "title": metadata.get('/Title', ''),
                    "author": metadata.get('/Author', ''),
                    "subject": metadata.get('/Subject', ''),
                    "creator": metadata.get('/Creator', ''),
                    "producer": metadata.get('/Producer', ''),
                    "creation_date": metadata.get('/CreationDate', ''),
                    "pages": len(pdf_reader.pages)
                }
        except Exception as e:
            logger.error(f"Error extracting metadata: {e}")
            return {}
