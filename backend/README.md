# PDF Extraction Tool - Backend

FastAPI backend service for extracting structured data from PDF files using LLMs.

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
```
MISTRAL_API_KEY=your_mistral_api_key_here
GROQ_API_KEY=your_groq_api_key_here
```

### 3. Create Directories

```bash
mkdir -p uploads outputs templates examples/sample_pdfs examples/expected_outputs
```

### 4. Run Server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API Documentation

Once running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Architecture

```
backend/
├── app/
│   ├── services/
│   │   ├── pdf_extractor.py       # PDF text extraction with fallbacks
│   │   ├── llm_service.py          # LLM integration (Mistral + Groq)
│   │   ├── excel_generator.py      # Excel file generation
│   │   └── accuracy_calculator.py  # Accuracy metrics calculation
│   └── models/
│       └── schemas.py               # Pydantic models
├── main.py                          # FastAPI application
├── requirements.txt
└── .env.example
```

## Services

### PDFExtractor
- Extracts text from PDFs using multiple methods
- **Primary**: pdfplumber (handles tables)
- **Fallback**: PyPDF2 (robust text extraction)
- Returns cleaned, normalized text

### LLMService
- Manages LLM-based data extraction
- **Primary LLM**: Mistral AI (mistral-large-latest)
- **Fallback LLM**: Groq (mixtral-8x7b-32768)
- Includes retry logic with exponential backoff
- Validates and cleans extracted data

### ExcelGenerator
- Generates Excel files following ILPA template structure
- Creates multiple sheets:
  - Executive Summary
  - Schedule of Investments
  - Portfolio Companies
  - Financial Statements
  - Footnotes
- Applies professional formatting

### AccuracyCalculator
- Calculates extraction accuracy metrics
- Compares extracted vs expected data
- Provides field-level accuracy details
- Supports string similarity and numerical comparison

## Error Handling

All services implement comprehensive error handling:
- Retry mechanisms
- Fallback strategies
- Detailed logging
- User-friendly error messages

## Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app

# Run specific test file
pytest tests/test_pdf_extractor.py -v
```

## Performance

- Async/await for concurrent operations
- Efficient PDF parsing
- Optimized LLM prompts
- Structured data validation

## Monitoring

Check logs at `app.log` for detailed execution traces.