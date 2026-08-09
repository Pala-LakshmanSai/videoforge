import json

from .health import health_payload

print(json.dumps(health_payload(), sort_keys=True))
