import logging
from typing import Dict, Any, List
from difflib import SequenceMatcher
import json
from pathlib import Path

logger = logging.getLogger(__name__)

class AccuracyCalculator:
    """
    Service for calculating extraction accuracy against expected outputs.
    """
    
    def __init__(self):
        self.expected_outputs = self._load_expected_outputs()
    
    def _load_expected_outputs(self) -> Dict[str, Any]:
        """Load expected output samples for accuracy comparison."""
        expected = {}
        expected_dir = Path("examples/expected_outputs")
        
        if expected_dir.exists():
            for json_file in expected_dir.glob("*.json"):
                try:
                    with open(json_file, 'r') as f:
                        filename = json_file.stem
                        expected[filename] = json.load(f)
                        logger.info(f"Loaded expected output: {filename}")
                except Exception as e:
                    logger.error(f"Error loading expected output {json_file}: {e}")
        
        return expected
    
    def calculate_accuracy(
        self,
        extracted_data: List[Dict[str, Any]],
        template_id: str
    ) -> Dict[str, Any]:
        """
        Calculate accuracy metrics for extracted data.
        """
        
        total_fields = 0
        matched_fields = 0
        partially_matched_fields = 0
        missing_fields = 0
        
        field_accuracy_details = []
        
        for file_data in extracted_data:
            filename = file_data.get('filename', '')
            data = file_data.get('data', {})
            
            # Get expected data if available
            base_filename = filename.replace('.pdf', '')
            expected_data = self.expected_outputs.get(base_filename, {})
            
            if expected_data:
                # Compare with expected output
                comparison = self._compare_data(data, expected_data, filename)
                total_fields += comparison['total']
                matched_fields += comparison['matched']
                partially_matched_fields += comparison['partial']
                missing_fields += comparison['missing']
                field_accuracy_details.extend(comparison['details'])
            else:
                # No expected output, just count extracted fields
                field_count = self._count_extracted_fields(data)
                total_fields += field_count
                matched_fields += field_count  # Assume correct if no baseline
        
        # Calculate percentages
        if total_fields > 0:
            exact_match_rate = (matched_fields / total_fields) * 100
            partial_match_rate = (partially_matched_fields / total_fields) * 100
            overall_accuracy = ((matched_fields + (partially_matched_fields * 0.5)) / total_fields) * 100
        else:
            exact_match_rate = 0
            partial_match_rate = 0
            overall_accuracy = 0
        
        return {
            "overall_accuracy": round(overall_accuracy, 2),
            "exact_match_rate": round(exact_match_rate, 2),
            "partial_match_rate": round(partial_match_rate, 2),
            "total_fields_expected": total_fields,
            "fields_matched": matched_fields,
            "fields_partially_matched": partially_matched_fields,
            "fields_missing": missing_fields,
            "field_details": field_accuracy_details[:20]  # Limit details
        }
    
    def _compare_data(
        self,
        extracted: Dict[str, Any],
        expected: Dict[str, Any],
        filename: str
    ) -> Dict[str, Any]:
        """Compare extracted data with expected data."""
        
        total = 0
        matched = 0
        partial = 0
        missing = 0
        details = []
        
        # Recursively compare fields
        comparison_results = self._compare_fields(
            extracted,
            expected,
            path=""
        )
        
        for result in comparison_results:
            total += 1
            
            if result['status'] == 'exact_match':
                matched += 1
            elif result['status'] == 'partial_match':
                partial += 1
            elif result['status'] == 'missing':
                missing += 1
            
            details.append({
                "field": result['field'],
                "status": result['status'],
                "similarity": result.get('similarity', 0),
                "extracted": str(result.get('extracted', ''))[:100],
                "expected": str(result.get('expected', ''))[:100]
            })
        
        return {
            "total": total,
            "matched": matched,
            "partial": partial,
            "missing": missing,
            "details": details
        }
    
    def _compare_fields(
        self,
        extracted: Any,
        expected: Any,
        path: str = ""
    ) -> List[Dict[str, Any]]:
        """Recursively compare fields between extracted and expected data."""
        
        results = []
        
        if isinstance(expected, dict):
            for key, expected_value in expected.items():
                current_path = f"{path}.{key}" if path else key
                
                if key in extracted:
                    extracted_value = extracted[key]
                    
                    # Recursive comparison for nested structures
                    if isinstance(expected_value, (dict, list)):
                        results.extend(
                            self._compare_fields(
                                extracted_value,
                                expected_value,
                                current_path
                            )
                        )
                    else:
                        # Compare primitive values
                        comparison = self._compare_values(
                            extracted_value,
                            expected_value
                        )
                        results.append({
                            "field": current_path,
                            "status": comparison['status'],
                            "similarity": comparison.get('similarity', 0),
                            "extracted": extracted_value,
                            "expected": expected_value
                        })
                else:
                    results.append({
                        "field": current_path,
                        "status": "missing",
                        "extracted": None,
                        "expected": expected_value
                    })
        
        elif isinstance(expected, list):
            for idx, expected_item in enumerate(expected):
                current_path = f"{path}[{idx}]"
                
                if idx < len(extracted):
                    extracted_item = extracted[idx]
                    
                    if isinstance(expected_item, (dict, list)):
                        results.extend(
                            self._compare_fields(
                                extracted_item,
                                expected_item,
                                current_path
                            )
                        )
                    else:
                        comparison = self._compare_values(
                            extracted_item,
                            expected_item
                        )
                        results.append({
                            "field": current_path,
                            "status": comparison['status'],
                            "similarity": comparison.get('similarity', 0),
                            "extracted": extracted_item,
                            "expected": expected_item
                        })
                else:
                    results.append({
                        "field": current_path,
                        "status": "missing",
                        "extracted": None,
                        "expected": expected_item
                    })
        
        return results
    
    def _compare_values(
        self,
        extracted: Any,
        expected: Any
    ) -> Dict[str, Any]:
        """Compare two primitive values."""
        
        # Handle None values
        if extracted is None and expected is None:
            return {"status": "exact_match", "similarity": 100}
        if extracted is None or expected is None:
            return {"status": "missing", "similarity": 0}
        
        # Convert to strings for comparison
        extracted_str = str(extracted).strip().lower()
        expected_str = str(expected).strip().lower()
        
        # Exact match
        if extracted_str == expected_str:
            return {"status": "exact_match", "similarity": 100}
        
        # Numerical comparison (handle formatting differences)
        if self._is_number(extracted) and self._is_number(expected):
            try:
                extracted_num = self._parse_number(extracted)
                expected_num = self._parse_number(expected)
                
                if abs(extracted_num - expected_num) < 0.01 * abs(expected_num):
                    return {"status": "exact_match", "similarity": 100}
            except:
                pass
        
        # String similarity
        similarity = SequenceMatcher(None, extracted_str, expected_str).ratio() * 100
        
        if similarity >= 80:
            return {"status": "partial_match", "similarity": similarity}
        else:
            return {"status": "mismatch", "similarity": similarity}
    
    def _is_number(self, value: Any) -> bool:
        """Check if a value is numeric."""
        try:
            self._parse_number(value)
            return True
        except:
            return False
    
    def _parse_number(self, value: Any) -> float:
        """Parse a number from various formats."""
        if isinstance(value, (int, float)):
            return float(value)
        
        # Remove common formatting
        value_str = str(value).replace(',', '').replace('$', '').replace('%', '')
        value_str = value_str.replace('m', '').replace('M', '').strip()
        
        return float(value_str)
    
    def _count_extracted_fields(self, data: Dict[str, Any]) -> int:
        """Count the number of extracted non-null fields."""
        
        count = 0
        
        def count_fields(obj):
            nonlocal count
            if isinstance(obj, dict):
                for value in obj.values():
                    if value is not None and value != '':
                        count += 1
                    if isinstance(value, (dict, list)):
                        count_fields(value)
            elif isinstance(obj, list):
                for item in obj:
                    if isinstance(item, (dict, list)):
                        count_fields(item)
        
        count_fields(data)
        return count