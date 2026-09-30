# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [2.0.0] — 2026-09-30

### Seguridad y pérdida de datos
- Antes de mover o borrar, cada copia y su original se vuelven a leer y se comparan con el SHA-256 completo; si han cambiado o no coinciden, no se tocan.
- **Cuarentena por defecto**: las copias se mueven a `_dupecleaner_cuarentena/` conservando su ruta. El borrado definitivo es una opción explícita.
- Los conjuntos comparados por muestras (modo rápido, > 20 MB) se marcan como «probables».
- El original de cada conjunto no se puede quitar.
- Corregida una inyección de HTML/JS mediante nombres de archivo.
- Detener y empezar otro escaneo ya no mezcla resultados.
- Content-Security-Policy estricta; sin CDN (fuentes e iconos alojados en el sitio).

### Corregido
- Carpetas llamadas `lib`, `bin`, `system`, `Library`… ya no se omiten fuera de una raíz de sistema.
- Errores de lectura visibles; el escaneo nunca se queda en «ejecutando».
- Detener corta al momento el hash de un archivo grande.
- El estado tras borrar (tarjetas, estadísticas, selección) queda coherente.
- Un conjunto de 3 o más copias ya no aparece repetido en la lista.
- La fuente Fira Code no se cargaba (`@import` mal colocado).

### Rendimiento
- SHA-256 en WebAssembly (hash-wasm) en un pool de workers.
- Prefiltro de 64 KB antes del hash completo.
- Sin esperas de un fotograma por carpeta o archivo; contadores incrementales; registro por lotes.
- Con 1 212 archivos de prueba: de 18,3 s a 1,6 s.

### Añadido
- PWA real (manifest, iconos, service worker; funciona sin conexión).
- Accesibilidad: diálogos con foco atrapado y Esc, separadores con teclado, etiquetas ARIA.
- Se recuerdan idioma y opciones de escaneo.
- Pruebas unitarias, end-to-end (solo OPFS o carpetas temporales), de accesibilidad y de rendimiento; lint; CI; despliegue a GitHub Pages solo si pasan las pruebas.
- `LICENSE` (MIT).

### Cambiado
- La app se sirve por HTTP (`npm run serve`); abrir `index.html` desde el disco ya no funciona.
- Google Sans sustituida por Inter (SIL OFL 1.1).

## [1.0.0] — 2026-03-03
- Versión inicial.
