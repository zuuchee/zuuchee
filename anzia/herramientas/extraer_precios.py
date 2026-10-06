"""Extrae los precios al público de la planilla mensual de Posventa ANZER.

Uso:
    python extraer_precios.py Detalle_Servicios.xlsx salida.json

Solo se leen precios sugeridos al público (IVA incluido). Los costos internos
(dealer net, márgenes) de la planilla nunca se exportan.
"""
import json
import re
import sys

import openpyxl

HOJAS_SERVICE = ["New Portfolio", "Old Portfolio", "Precios Vigentes Electricos"]
CATEGORIAS = {"AUTOS", "SUV´S", "PICKS-UPS", "PERFORMANCE", "COMERCIALES", "UTILITARIOS"}


def num(v):
    return round(v) if isinstance(v, (int, float)) else None


def limpiar(s):
    return re.sub(r"\s+", " ", str(s)).strip(" -")


def services_programados(wb):
    modelos = []
    for nombre in HOJAS_SERVICE:
        ws = wb[nombre]
        categoria, kms = None, []
        for row in ws.iter_rows(values_only=True):
            celdas = list(row[1:])
            if celdas and isinstance(celdas[0], str) and celdas[0].strip() in CATEGORIAS:
                categoria = celdas[0].strip()
                continue
            numeros = [c for c in celdas[2:] if isinstance(c, (int, float))]
            if celdas[0] in (None, "") and len(numeros) >= 5 and all(n < 1000 for n in numeros):
                kms = [int(n * 1000) for n in numeros]  # fila "Kilómetros (miles)"
                continue
            if len(celdas) > 1 and celdas[1] == "Fidelidad Ford" and celdas[0]:
                precios = [num(c) for c in celdas[2 : 2 + len(kms)]]
                modelos.append({
                    "modelo": limpiar(celdas[0]),
                    "categoria": categoria,
                    "hoja": nombre,
                    "services": [
                        {"km": km, "precio": p} for km, p in zip(kms, precios) if p
                    ],
                })
    return modelos


def mano_de_obra_y_lavado(wb):
    ws = wb["Mano de Obra"]
    hora, lavado, seccion = {}, {}, None
    for row in ws.iter_rows(values_only=True):
        c = [x for x in row if x not in (None, "")]
        if not c:
            continue
        if isinstance(c[0], str) and "PAUTA LAVADO" in str(c):
            seccion = "lavado"
            continue
        if isinstance(c[0], str) and isinstance(c[-1], (int, float)) and c[-1] > 1000:
            destino = lavado if seccion == "lavado" else hora
            destino[limpiar(c[0])] = num(c[-1])
    return {"valor_hora_con_iva": hora, "lavado_con_iva": lavado}


def combos(wb):
    ws = wb["Oport Mecanica Lig"]
    resultado, accion, columnas = {}, None, []
    for row in ws.iter_rows(values_only=True):
        c = list(row[1:])
        if isinstance(c[0], str) and c[0].startswith("Accion"):
            accion = limpiar(c[0])
            columnas = [limpiar(x) for x in c[1:] if x]
            resultado[accion] = []
        elif accion and isinstance(c[0], str):
            valores = [num(x) for x in c[1:] if x not in (None, "")]
            if any(valores) and not str(c[0]).startswith("Distir"):
                resultado[accion].append({"modelo": limpiar(c[0]), **dict(zip(columnas, valores))})
            elif str(c[0]).startswith("Distir"):
                accion = None
    return resultado


def main():
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    datos = {
        "fuente": "LISTA DE PRECIOS POSVENTA ANZER",
        "notas": [
            "Precios sugeridos al público, IVA incluido.",
            "Precio de contado: efectivo, débito, crédito en 1 pago u otros medios electrónicos.",
            "Services: incluyen aceite sintético Elaion, filtros y operaciones de control según el manual.",
            "No incluyen líquido de frenos/embrague ni refrigerante salvo que se indique.",
        ],
        "services_programados": services_programados(wb),
        "mano_de_obra": mano_de_obra_y_lavado(wb),
        "combos_del_mes": combos(wb),
    }
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
    print(f"{len(datos['services_programados'])} modelos exportados")


if __name__ == "__main__":
    main()
