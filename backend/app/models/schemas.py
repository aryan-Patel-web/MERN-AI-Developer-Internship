from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class FileResult(BaseModel):
    filename: str
    status: str
    data_points_extracted: int

class AccuracyReport(BaseModel):
    overall_accuracy: float
    exact_match_rate: float
    partial_match_rate: float
    total_fields_expected: int
    fields_matched: int
    fields_partially_matched: int
    fields_missing: int
    field_details: List[Dict[str, Any]]

class ExtractionResponse(BaseModel):
    job_id: str
    status: str
    files_processed: int
    results: List[FileResult]
    output_file: str
    accuracy: AccuracyReport

class HealthCheckResponse(BaseModel):
    status: str
    llm_service: Dict[str, str]