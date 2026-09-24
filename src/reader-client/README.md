# Cliente de puerta / lector (C1)

**Responsabilidad**: registrar la presentación de acceso, conservar un
diario local de eventos, solicitar una decisión al coordinador local (C2) y
comunicar el resultado al operador o dispositivo de puerta.

**Qué no debe implementarse aquí**: lógica de decisión de acceso. El
lector **no** decide el acceso de forma autónoma bajo ninguna
circunstancia, incluso ante pérdida de conectividad con C2.

**Componente relacionado**: C1 — Cliente de puerta o lector.

**Decisiones pendientes**: tecnología/plataforma del cliente, formato del
diario local y protocolo de comunicación con C2.
