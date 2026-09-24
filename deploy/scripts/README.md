# Scripts de despliegue

**Responsabilidad**: alojar los futuros scripts de creación, verificación,
restauración y eliminación del entorno local (Minikube), así como scripts
de construcción local de imágenes.

**Qué no debe implementarse aquí**: secretos embebidos en los scripts. Los
secrets se crean externamente y nunca se almacenan en Git (ver
[config/README.md](../../config/README.md)).

**Componente relacionado**: transversal — automatiza el ciclo de vida del
entorno de todos los componentes (C1–C5, D1–D2).

**Decisiones pendientes**: lenguaje/herramienta de los scripts (se prevé
PowerShell para Windows) y su nomenclatura final.
