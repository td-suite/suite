#!/usr/bin/env python3
"""Genera i PDF sintetici di prova del modulo Referti esterni (nessun PDF reale e' disponibile in questa sessione).
I layout imitano, per quanto descritto nella specifica (/tmp/claude-0/referti_spec.md), i referti di Bianalisi Firenze,
Cerba RDI Limena (merge di 3 pazienti KPC) e Cerba Nuova Igea (urinocoltura con due microrganismi affiancati), piu' un
PDF "non referto" (lettera commerciale). I dati dei pazienti sono inventati.
Esecuzione: python3 genera.py  (scrive i PDF accanto allo script). I parser vanno ricalibrati sui PDF reali."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Font TrueType con i glifi delle legature (ﬁ ﬂ): cosi' pdftotext restituisce U+FB01/U+FB02 come nei PDF reali
_DV = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
if os.path.exists(_DV):
    pdfmetrics.registerFont(TTFont('DejaVu', _DV))
    LIG_FONT = 'DejaVu'
else:
    LIG_FONT = 'Helvetica'

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = A4
FONT = 'Helvetica'
BOLD = 'Helvetica-Bold'


class Pagina:
    def __init__(self, c):
        self.c = c
        self.y = H - 40

    def riga(self, parti, size=9, bold=False, dy=12):
        """parti: lista di (x in punti, testo)"""
        for x, t in parti:
            lig = any(ch in t for ch in '\ufb01\ufb02')
            self.c.setFont(LIG_FONT if lig else (BOLD if bold else FONT), size)
            self.c.drawString(x, self.y, t)
        self.y -= dy

    def vuota(self, dy=10):
        self.y -= dy


# ---------------------------------------------------------------- Bianalisi (variante B, corpo 1), 2 pagine
def bianalisi():
    c = canvas.Canvas(os.path.join(HERE, 'bianalisi_urinocoltura.pdf'), pagesize=A4)
    def intestazione(p, n, tot):
        p.riga([(40, 'BIANALISI S.p.A. Laboratorio Firenze')], size=11, bold=True, dy=13)
        p.riga([(40, 'Via dei Laboratori 12 - 50100 Firenze (FI) - Direttore: dott. M. Bianchi')], size=8, dy=14)
        p.riga([(40, 'Referto R3YEA050123 del 05/10/2026'), (320, 'Accettazione A3YEA050123 del 02/10/2026')], size=9, dy=13)
        p.riga([(40, 'ROSSI MARIA'), (320, 'F-16/04/1974 (anni 52) TOLAFI')], size=9, bold=True, dy=14)
        p.riga([(40, 'Analisi'), (260, 'Risultati'), (430, 'Intervalli di Riferimento')], size=8, bold=True, dy=14)
        p.c.line(40, p.y + 8, W - 40, p.y + 8)
        p.vuota(4)
    def pie(p, n, tot):
        p.c.setFont(FONT, 8)
        p.c.drawString(40, 30, 'Pagina %d di %d' % (n, tot))
        p.c.drawString(320, 30, 'Referto R3YEA050123 - ROSSI MARIA')

    p = Pagina(c)
    intestazione(p, 1, 2)
    p.riga([(40, 'MICROBIOLOGIA')], size=10, bold=True, dy=14)
    p.riga([(40, 'U - Urinocoltura (1)'), (260, 'Positivo')], size=9, bold=True)
    p.riga([(40, 'Metodo: Colturale')], size=8)
    p.riga([(40, 'Materiale Urine')], size=8)
    p.riga([(40, 'Germe Isolato'), (260, 'Escherichia coli')], size=9)
    p.riga([(40, 'Carica Batterica'), (260, '10^5 UFC/mL')], size=9)
    p.riga([(40, 'Metodo: Colturale')], size=8)
    p.riga([(40, 'S = Sensibile a dosaggio standard (EUCAST)')], size=8)
    p.riga([(40, 'I = Sensibile ad esposizione aumentata (EUCAST)')], size=8)
    p.riga([(40, 'R = Resistente (EUCAST)')], size=8)
    p.riga([(40, 'MIC = Concentrazione Minima Inibente (mg/L)')], size=8)
    p.riga([(40, 'Materiale Urine')], size=8)
    p.riga([(40, 'Germe Isolato'), (260, 'Escherichia coli')], size=9)
    p.riga([(40, 'Amoxicillina/Ac. Clavulanico'), (260, 'Sensibile - MIC <=4')], size=9)
    p.riga([(40, 'Ceﬁxime'), (260, 'Resistente - MIC >16')], size=9)
    p.riga([(40, 'ESBL (Extended Spectrum Beta Lactamase)'), (260, 'Negativo')], size=9)
    p.riga([(40, 'Ciproﬂoxacina'), (260, 'Intermedio - MIC 0,25')], size=9)
    p.riga([(40, 'Fosfomicina'), (260, 'Sensibile - MIC <=8')], size=9)
    p.riga([(40, 'Nitrofurantoina'), (260, 'Sensibile - MIC <=16')], size=9)
    pie(p, 1, 2)
    c.showPage()

    p = Pagina(c)
    intestazione(p, 2, 2)
    p.riga([(40, 'Trimetoprim/Sulfametossazolo'), (260, 'Resistente - MIC >4')], size=9)
    p.riga([(40, 'Gentamicina'), (260, 'Sensibile - MIC <=2')], size=9)
    p.riga([(40, 'Esame batterioscopico urine'), (260, 'Sviluppo di un')], size=9)
    p.riga([(260, 'discreto')], size=9)
    p.riga([(260, 'numero di')], size=9)
    p.riga([(260, 'colonie')], size=9)
    p.riga([(40, 'Metodo: Microscopico')], size=8)
    p.vuota(8)
    p.riga([(40, 'MICROBIOLOGIA MOLECOLARE')], size=10, bold=True, dy=14)
    p.riga([(40, 'Trichomonas vaginalis PCR'), (260, 'Negativo'), (430, 'Negativo')], size=9, bold=True)
    p.riga([(40, 'Metodo: PCR Real Time')], size=8)
    p.riga([(40, 'Materiale Urine')], size=8)
    p.vuota(14)
    p.riga([(40, '(1) Esame eseguito Bianalisi Verano Brianza (MB)')], size=8)
    p.riga([(40, 'Il presente documento annulla e sostituisce il referto R3YEA050100 del 05/10/2026')], size=8)
    pie(p, 2, 2)
    c.showPage()
    c.save()


# ---------------------------------------------------------------- Cerba RDI Limena (variante A, corpo 1), merge di 3 pazienti KPC
def cerba_rdi():
    c = canvas.Canvas(os.path.join(HERE, 'merge_kpc_rdi.pdf'), pagesize=A4)
    pazienti = [
        ('GIANNINI PAOLA', '12/03/1960', 'F', '2026/0456781', '04/09/2026'),
        ('BEGUM FATIMA', '30/07/1988', 'F', '2026/0456782', '04/09/2026'),
        ('CRS LCN', '01/01/1950', 'M', '2026/0456783', '04/09/2026'),
    ]
    for i, (nome, nascita, sesso, acc, data) in enumerate(pazienti, start=1):
        p = Pagina(c)
        p.riga([(40, 'Cerba HealthCare')], size=12, bold=True, dy=13)
        p.riga([(40, 'Rete Diagnostica Italiana S.r.l. VIA DEL SANTO 145/147 LIMENA (PD)')], size=9, dy=12)
        p.riga([(40, 'Direttore del laboratorio: dott.ssa L. Verdi')], size=8, dy=14)
        p.riga([(40, 'Paziente: ' + nome), (330, 'Nato il: ' + nascita), (460, 'Sesso: ' + sesso)], size=9, bold=True, dy=13)
        p.riga([(40, 'Accettazione n° ' + acc), (330, 'Data Acc. ' + data)], size=9, dy=14)
        p.riga([(40, 'Esame'), (250, 'Risultato'), (360, 'U.M.'), (420, 'Valori di Riferimento')], size=8, bold=True, dy=14)
        p.c.line(40, p.y + 8, W - 40, p.y + 8)
        p.vuota(4)
        p.riga([(40, 'MICROBIOLOGIA')], size=10, bold=True, dy=14)
        p.riga([(40, 'KPC test di conferma'), (250, 'Negativo'), (420, 'Negativo')], size=9, bold=True)
        p.riga([(40, 'Metodo: Colturale su terreno cromogeno')], size=8)
        p.riga([(40, 'Materiale: T.AMIES')], size=8)
        p.riga([(40, 'Sede Anatomica: rettale')], size=8)
        p.c.setFont(FONT, 8)
        p.c.drawString(40, 30, 'Pagina 1 di 1')
        p.c.drawString(300, 30, 'Accettazione n° ' + acc + ' - ' + nome)
        c.showPage()
    c.save()


# ---------------------------------------------------------------- Cerba Nuova Igea (variante A, corpo 2), 2 microrganismi
def cerba_nuova_igea():
    c = canvas.Canvas(os.path.join(HERE, 'nuova_igea_urinocoltura.pdf'), pagesize=A4)
    p = Pagina(c)
    p.riga([(40, 'Cerba HealthCare Toscana s.r.l. - Nuova Igea, Via Duccio di Buoninsegna 54 - 50143 Firenze')], size=9, bold=True, dy=13)
    p.riga([(40, 'Laboratorio analisi cliniche - Direttore Sanitario dott. P. Neri')], size=8, dy=14)
    p.riga([(40, 'Paziente: GRASSI TIZIANA'), (330, 'Nato il: 05/05/1955'), (460, 'Sesso: F')], size=9, bold=True, dy=13)
    p.riga([(40, 'Accettazione n° 26/001234'), (330, 'Data Acc. 10/10/2026')], size=9, dy=14)
    p.c.line(40, p.y + 8, W - 40, p.y + 8)
    p.vuota(4)
    p.riga([(40, 'MICROBIOLOGIA')], size=10, bold=True, dy=14)
    p.riga([(40, 'URINOCOLTURA')], size=10, bold=True, dy=13)
    p.riga([(40, 'Metodo: Colturale'), (260, 'Materiale: Urine mitto intermedio')], size=8)
    p.riga([(40, 'Nuova descrizione dell\'esame come da Nomenclatore 2025: Esame colturale delle urine')], size=8)
    p.riga([(40, 'Specie Microbiche'), (260, 'Escherichia coli, Klebsiella pneumoniae')], size=9)
    p.riga([(40, 'Esito'), (260, 'Positivo')], size=9)
    p.riga([(40, 'Carica Microbica Totale'), (260, '100.000 UFC/ml')], size=9)
    p.riga([(40, 'Antibiogramma/Antimicogramma'), (260, 'Interpretazione secondo EUCAST 2025. Sono riportati solo gli')], size=9)
    p.riga([(260, 'antibiotici con indicazione per le infezioni urinarie.')], size=9)
    p.vuota(6)
    p.riga([(40, 'Microrganismo #1: Escherichia coli'), (300, 'Microrganismo #2: Klebsiella pneumoniae')], size=9, bold=True)
    p.riga([(40, 'Carica Batterica: 100.000 UFC/ml'), (300, 'Carica Batterica Totale: 100.000 UFC/ml')], size=9)
    p.riga([(40, 'R: Resistente I: Sensibile con aumentata esposizione al farmaco S: Sensibile')], size=8)
    p.riga([(40, 'ANTIBIOTICO'), (250, '#1'), (290, 'MIC'), (370, '#2'), (410, 'MIC')], size=8, bold=True)
    righe = [
        ('AMOXICILLINA/AC.CLAVULANICO', 'S', '<=8', 'R', '>32'),
        ('CEFIXIME', 'S', '<=1', 'S', '<=1'),
        ('CIPROFLOXACINA', 'S', '<=0,25', '', ''),
        ('FOSFOMICINA', 'S', '<=16', 'R', '>128'),
        ('NITROFURANTOINA', 'S', '<=16', '', ''),
        ('TRIMETOPRIM/SULFAMETOSSAZOLO', 'R', '>4', 'S', '<=0,5'),
    ]
    for a, s1, m1, s2, m2 in righe:
        parti = [(40, a), (250, s1), (290, m1)]
        if s2:
            parti += [(370, s2), (410, m2)]
        p.riga(parti, size=9)
    p.vuota(8)
    p.riga([(40, 'ESAME MICROSCOPICO DIVERSI')], size=10, bold=True, dy=13)
    p.riga([(40, 'Metodo: Microscopico'), (260, 'Materiale: Urine mitto intermedio')], size=8)
    p.riga([(40, 'Cellule'), (260, 'Rare cellule epiteliali')], size=9)
    p.riga([(40, 'Flogosi'), (260, 'Presente')], size=9)
    p.riga([(40, 'Esame microscopico dopo colorazione di Gram'), (260, 'Presenza di bacilli Gram negativi')], size=9)
    p.c.setFont(FONT, 8)
    p.c.drawString(40, 30, 'Pagina 1 di 1')
    p.c.drawString(300, 30, 'Accettazione n° 26/001234 - GRASSI TIZIANA')
    c.showPage()
    c.save()


# ---------------------------------------------------------------- Non referto: lettera commerciale
def non_referto():
    c = canvas.Canvas(os.path.join(HERE, 'lettera_offerta.pdf'), pagesize=A4)
    p = Pagina(c)
    p.riga([(40, 'Toscana Diagnostica S.r.l.')], size=12, bold=True, dy=16)
    p.riga([(40, 'Spett.le Fondazione Esempio')], size=10, dy=14)
    p.riga([(40, 'Oggetto: offerta per il servizio di analisi di laboratorio')], size=10, bold=True, dy=16)
    for t in ['Con la presente siamo lieti di sottoporre alla Vostra attenzione la nostra migliore offerta',
              'per il servizio di analisi di laboratorio in service, comprensivo di ritiro dei campioni.',
              'Restiamo a disposizione per ogni chiarimento.', 'Cordiali saluti.']:
        p.riga([(40, t)], size=10, dy=14)
    c.showPage()
    c.save()


if __name__ == '__main__':
    bianalisi(); cerba_rdi(); cerba_nuova_igea(); non_referto()
    print('PDF di prova generati in', HERE)
    # Testo per i test senza poppler: stesso output di `pdftotext -layout` (form feed tra le pagine)
    import shutil, subprocess
    if shutil.which('pdftotext'):
        for f in ('bianalisi_urinocoltura', 'merge_kpc_rdi', 'nuova_igea_urinocoltura', 'lettera_offerta'):
            subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', os.path.join(HERE, f + '.pdf'), os.path.join(HERE, f + '.txt')], check=True)
        print('Testo estratto (.txt) aggiornato')
