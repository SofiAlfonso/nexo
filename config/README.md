# Configuración

**Responsabilidad**: alojar configuración no sensible y ejemplos de
variables de entorno (`config/examples/`) que documenten qué secretos
necesita NEXO, sin contener sus valores reales.

**Qué no debe implementarse aquí**: ningún secreto real — tokens de Grafana
Cloud, contraseñas de PostgreSQL, kubeconfig, certificados ni cualquier
credencial. Los secretos se crean **externamente** al repositorio (por
ejemplo, como Kubernetes Secrets aplicados manualmente o mediante un
gestor de secretos) y nunca se versionan en Git.

**Componente relacionado**: transversal — todos los componentes que
requieren configuración externa (C2, C4, D1, D2, Collector).

**Decisiones pendientes**: mecanismo definitivo de gestión de secretos para
Minikube (Kubernetes Secrets manuales vs. herramienta externa).
