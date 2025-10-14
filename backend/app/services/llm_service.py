import os
import json
import logging
from typing import Dict, Any, Optional
from mistralai.client import MistralClient
from mistralai.models.chat_completion import ChatMessage
from groq import Groq
import asyncio
from pathlib import Path

logger = logging.getLogger(__name__)

class LLMService:
    """
    Service for handling LLM-based data extraction with fallback mechanisms.
    """
    
    def _init_(self):
        self.mistral_api_key = os.getenv("MISTRAL_API_KEY")
        self.groq_api_key = os.getenv("GROQ_API_KEY")
        
        # Initialize clients
        self.mistral_client = None
        self.groq_client = None
        
        if self.mistral_api_key:
            try:
                self.mistral_client = MistralClient(api_key=self.mistral_api_key)
                logger.info("Mistral client initialized successfully")
            except Exception as e:
                logger.warning(f"Failed to initialize Mistral client: {e}")
        
        if self.groq_api_key:
            try:
                self.groq_client = Groq(api_key=self.groq_api_key)
                logger.info("Groq client initialized successfully")
            except Exception as e:
                logger.warning(f"Failed to initialize Groq client: {e}")
        
        # Load templates
        self.templates = self._load_templates()
    
    def _load_templates(self) -> Dict[str, Any]:
        """Load extraction templates from JSON files."""
        templates = {}
        template_dir = Path("templates")
        
        for template_file in template_dir.glob("*.json"):
            try:
                with open(template_file, 'r') as f:
                    template_id = template_file.stem
                    templates[template_id] = json.load(f)
                    logger.info(f"Loaded template: {template_id}")
            except Exception as e:
                logger.error(f"Error loading template {template_file}: {e}")
        
        return templates
    
    def _build_extraction_prompt(
        self,
        text: str,
        template_id: str,
        filename: str
    ) -> str:
        """Build the extraction prompt based on the template."""
        
        template = self.templates.get(template_id, {})
        
        prompt = f"""You are an expert financial data extraction assistant. Extract structured data from the provided PDF text according to the specified template.

IMPORTANT INSTRUCTIONS:
1. Extract ALL data points specified in the template
2. Return data in valid JSON format only
3. Use null for missing values, never skip fields
4. Preserve exact numerical values with proper formatting
5. Extract dates in ISO format (YYYY-MM-DD)
6. For currency values, include the amount as a number
7. Extract nested structures carefully (portfolio companies, investments, etc.)
8. Ensure all field names match the template exactly

DOCUMENT: {filename}

TEMPLATE STRUCTURE:
{json.dumps(template.get('schema', {}), indent=2)}

EXTRACTION GUIDELINES:
{json.dumps(template.get('guidelines', {}), indent=2)}

PDF TEXT CONTENT:
{text}

Extract the data and return ONLY a valid JSON object matching the template schema. Do not include any explanations or markdown formatting."""

        return prompt
    
    async def _extract_with_mistral(
        self,
        prompt: str,
        max_retries: int = 3
    ) -> Optional[Dict[str, Any]]:
        """Extract data using Mistral AI with retry logic."""
        
        if not self.mistral_client:
            logger.warning("Mistral client not available")
            return None
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting Mistral extraction (attempt {attempt + 1})")
                
                messages = [
                    ChatMessage(role="user", content=prompt)
                ]
                
                response = self.mistral_client.chat(
                    model="mistral-large-latest",
                    messages=messages,
                    temperature=0.1,
                    max_tokens=4000
                )
                
                content = response.choices[0].message.content
                
                # Parse JSON response
                data = self._parse_json_response(content)
                
                if data:
                    logger.info("Mistral extraction successful")
                    return data
                
            except Exception as e:
                logger.warning(f"Mistral extraction attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
        
        return None
    
    async def _extract_with_groq(
        self,
        prompt: str,
        max_retries: int = 3
    ) -> Optional[Dict[str, Any]]:
        """Extract data using Groq as fallback with retry logic."""
        
        if not self.groq_client:
            logger.warning("Groq client not available")
            return None
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting Groq extraction (attempt {attempt + 1})")
                
                response = self.groq_client.chat.completions.create(
                    model="mixtral-8x7b-32768",
                    messages=[
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    temperature=0.1,
                    max_tokens=4000
                )
                
                content = response.choices[0].message.content
                
                # Parse JSON response
                data = self._parse_json_response(content)
                
                if data:
                    logger.info("Groq extraction successful")
                    return data
                
            except Exception as e:
                logger.warning(f"Groq extraction attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
        
        return None
    
    def _parse_json_response(self, content: str) -> Optional[Dict[str, Any]]:
        """Parse JSON from LLM response, handling markdown code blocks."""
        
        try:
            # Remove markdown code blocks if present
            content = content.strip()
            if content.startswith("json"):
                content = content[7:]
            if content.startswith(""):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            
            content = content.strip()
            
            # Parse JSON
            data = json.loads(content)
            return data
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing error: {e}")
            logger.debug(f"Content: {content[:500]}")
            return None
    
    async def extract_data(
        self,
        text: str,
        template_id: str,
        filename: str
    ) -> Dict[str, Any]:
        """
        Extract structured data from text using LLM with fallback.
        """
        
        # Build prompt
        prompt = self._build_extraction_prompt(text, template_id, filename)
        
        # Try Mistral first
        data = await self._extract_with_mistral(prompt)
        
        # Fallback to Groq if Mistral fails
        if not data:
            logger.info("Falling back to Groq")
            data = await self._extract_with_groq(prompt)
        
        # If both fail, raise error
        if not data:
            raise Exception("Failed to extract data with both Mistral and Groq")
        
        # Validate and clean data
        data = self._validate_and_clean(data, template_id)
        
        return data
    
    def _validate_and_clean(
        self,
        data: Dict[str, Any],
        template_id: str
    ) -> Dict[str, Any]:
        """Validate and clean extracted data against template."""
        
        template = self.templates.get(template_id, {})
        schema = template.get('schema', {})
        
        # Ensure all required fields exist
        for field, field_config in schema.items():
            if field not in data:
                data[field] = None
                logger.warning(f"Missing field {field}, setting to null")
        
        return data
    
    async def check_health(self) -> Dict[str, Any]:
        """Check health of LLM services."""
        
        status = {
            "mistral": "unavailable",
            "groq": "unavailable"
        }
        
        if self.mistral_client:
            try:
                # Simple test call
                response = self.mistral_client.chat(
                    model="mistral-large-latest",
                    messages=[ChatMessage(role="user", content="test")],
                    max_tokens=10
                )
                status["mistral"] = "available"
            except Exception as e:
                logger.error(f"Mistral health check failed: {e}")
        
        if self.groq_client:
            try:
                response = self.groq_client.chat.completions.create(
                    model="mixtral-8x7b-32768",
                    messages=[{"role": "user", "content": "test"}],
                    max_tokens=10
                )
                status["groq"] = "available"
            except Exception as e:
                logger.error(f"Groq health check failed: {e}")
        
        return status