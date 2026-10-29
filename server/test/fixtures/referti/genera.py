#!/usr/bin/env python3
"""Genera i PDF sintetici di prova del modulo Referti esterni (nessun PDF reale e' disponibile in questa sessione).
I layout imitano, per quanto descritto nella specifica (/tmp/claude-0/referti_spec.md), i referti di Bianalisi Firenze,
Cerba RDI Limena (merge di 3 pazienti KPC) e Cerba Nuova Igea (urinocoltura con due microrganismi affiancati), piu' un
PDF "non referto" (lettera commerciale). I dati dei pazienti sono inventati.
Aggiornati il 29/10/2026 (indicazione del CEO): l'intestazione paziente porta anche luogo di nascita e indirizzo (con etichette
diverse per sorgente: "Nata a"/"Indirizzo", "Luogo di nascita"/"Residenza", "Nato il … a"); intestazioni e pie' del laboratorio
esterno sono realistici (direttore, medico richiedente, firma, diciture legali, P.IVA, contatti) e il parser deve scartarli:
nel referto TD e in testo_sorgente resta solo il riquadro dei risultati.
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
        p.riga([(40, 'ROSSI MARIA'), (320, 'F-16/04/1974 (anni 52) TOLAFI')], size=9, bold=True, dy=12)
        p.riga([(40, 'Nata a: PRATO (PO)'), (320, 'Indirizzo: Via dei Mille 3, 50131 Firenze (FI)')], size=8, dy=12)
        p.riga([(40, 'Medico richiedente: dott. G. Esposito'), (320, 'Reparto: Service Toscana Diagnostica')], size=8, dy=14)
        p.riga([(40, 'Analisi'), (260, 'Risultati'), (430, 'Intervalli di Riferimento')], size=8, bold=True, dy=14)
        p.c.line(40, p.y + 8, W - 40, p.y + 8)
        p.vuota(4)
    def pie(p, n, tot):
        p.c.setFont(FONT, 8)
        if n == tot:
            p.c.drawString(40, 70, 'Firma: Il Direttore del Laboratorio dott. M. Bianchi (documento firmato digitalmente ai sensi del D.Lgs. 82/2005)')
            p.c.drawString(40, 58, 'Il presente referto non puo\' essere riprodotto parzialmente. Bianalisi S.p.A. - P.IVA 01234567890')
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
        ('GIANNINI PAOLA', '12/03/1960', 'F', '2026/0456781', '04/09/2026', 'FIRENZE (FI)', 'Via Roma 12, 50123 Firenze (FI)'),
        ('BEGUM FATIMA', '30/07/1988', 'F', '2026/0456782', '04/09/2026', 'DHAKA (BANGLADESH)', ''),
        ('CRS LCN', '01/01/1950', 'M', '2026/0456783', '04/09/2026', 'SESTO FIORENTINO (FI)', 'Via di Pratignone 5, 50019 Sesto Fiorentino (FI)'),
    ]
    for i, (nome, nascita, sesso, acc, data, luogo, indirizzo) in enumerate(pazienti, start=1):
        p = Pagina(c)
        p.riga([(40, 'Cerba HealthCare')], size=12, bold=True, dy=13)
        p.riga([(40, 'Rete Diagnostica Italiana S.r.l. VIA DEL SANTO 145/147 LIMENA (PD)')], size=9, dy=12)
        p.riga([(40, 'Tel. 049 0000000 - Fax 049 0000001 - P.IVA 02345678901')], size=8, dy=12)
        p.riga([(40, 'Direttore del laboratorio: dott.ssa L. Verdi')], size=8, dy=14)
        p.riga([(40, 'Paziente: ' + nome), (330, 'Nato il: ' + nascita), (460, 'Sesso: ' + sesso)], size=9, bold=True, dy=13)
        p.riga([(40, 'Luogo di nascita: ' + luogo)] + ([(330, 'Residenza: ' + indirizzo)] if indirizzo else []), size=8, dy=12)
        p.riga([(40, 'Accettazione n° ' + acc), (330, 'Data Acc. ' + data)], size=9, dy=12)
        p.riga([(40, 'Medico richiedente: dott. G. Esposito - Toscana Diagnostica')], size=8, dy=14)
        p.riga([(40, 'Esame'), (250, 'Risultato'), (360, 'U.M.'), (420, 'Valori di Riferimento')], size=8, bold=True, dy=14)
        p.c.line(40, p.y + 8, W - 40, p.y + 8)
        p.vuota(4)
        p.riga([(40, 'MICROBIOLOGIA')], size=10, bold=True, dy=14)
        p.riga([(40, 'KPC test di conferma'), (250, 'Negativo'), (420, 'Negativo')], size=9, bold=True)
        p.riga([(40, 'Metodo: Colturale su terreno cromogeno')], size=8)
        p.riga([(40, 'Materiale: T.AMIES')], size=8)
        p.riga([(40, 'Sede Anatomica: rettale')], size=8)
        p.c.setFont(FONT, 8)
        p.c.drawString(40, 70, 'Validato da: dott.ssa L. Verdi - Documento firmato digitalmente ai sensi del D.Lgs. 82/2005 e s.m.i.')
        p.c.drawString(40, 58, 'Il presente referto e\' riservato: non puo\' essere riprodotto parzialmente. Rete Diagnostica Italiana S.r.l.')
        p.c.drawString(40, 30, 'Pagina 1 di 1')
        p.c.drawString(300, 30, 'Accettazione n° ' + acc + ' - ' + nome)
        c.showPage()
    c.save()


# ---------------------------------------------------------------- Cerba Nuova Igea (variante A, corpo 2), 2 microrganismi
def cerba_nuova_igea():
    c = canvas.Canvas(os.path.join(HERE, 'nuova_igea_urinocoltura.pdf'), pagesize=A4)
    p = Pagina(c)
    p.riga([(40, 'Cerba HealthCare Toscana s.r.l. - Nuova Igea, Via Duccio di Buoninsegna 54 - 50143 Firenze')], size=9, bold=True, dy=13)
    p.riga([(40, 'Laboratorio analisi cliniche - Direttore Sanitario dott. P. Neri - P.IVA 03456789012')], size=8, dy=14)
    p.riga([(40, 'Paziente: GRASSI TIZIANA'), (330, 'Nato il: 05/05/1955 a FIRENZE (FI)'), (520, 'Sesso: F')], size=9, bold=True, dy=13)
    p.riga([(40, 'Indirizzo: Via Pisana 120, 50143 Firenze (FI)')], size=8, dy=12)
    p.riga([(40, 'Accettazione n° 26/001234'), (330, 'Data Acc. 10/10/2026')], size=9, dy=12)
    p.riga([(40, 'Richiedente: Toscana Diagnostica S.r.l. (service)')], size=8, dy=14)
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
    p.c.drawString(40, 70, 'Firma: Il Direttore Sanitario dott. P. Neri (firmato digitalmente)')
    p.c.drawString(40, 58, 'Cerba HealthCare Toscana s.r.l. - www.cerbahealthcare.it - Tel. 055 0000000')
    p.c.drawString(40, 30, 'Pagina 1 di 1')
    p.c.drawString(300, 30, 'Accettazione n° 26/001234 - GRASSI TIZIANA')
    c.showPage()
    c.save()


# ---------------------------------------------------------------- Sorgente non riconosciuta (ALTRO, corpo 1): caso reale del 29/10/2026
# Laboratorio esterno sconosciuto, cliente "TOSCANA DIAGNOSTICA S.R.L." nell'intestazione, etichetta PAZIENTE, testata di tabella,
# settore FARMACI con una sola riga esame, firma digitale e diciture legali in coda: tutto cio' che non e' il riquadro va scartato.
def altro_farmaci():
    c = canvas.Canvas(os.path.join(HERE, 'altro_farmaci.pdf'), pagesize=A4)
    p = Pagina(c)
    p.riga([(40, 'LABORATORIO ANALISI CLINICHE SAN MARCO S.r.l.')], size=11, bold=True, dy=13)
    p.riga([(40, 'Via delle Analisi 7 - 50122 Firenze (FI) - Tel. 055 0000002 - P.IVA 04567890123')], size=8, dy=12)
    p.riga([(40, 'Cliente: TOSCANA DIAGNOSTICA S.R.L.'), (330, 'Codice cliente: 0451')], size=8, dy=14)
    p.riga([(40, 'TOSCANA DIAGNOSTICA S.R.L.')], size=9, bold=True, dy=14)
    p.riga([(40, 'Paziente: CHIARI STEFANIA')], size=9, bold=True, dy=12)
    p.riga([(40, 'Data di nascita: 25/05/1965'), (330, 'Sesso: F')], size=9, dy=12)
    p.riga([(40, 'Accettazione n° 3370'), (330, 'Data Acc. 27/10/2026')], size=9, dy=14)
    p.riga([(40, 'Esame'), (250, 'Risultato'), (360, 'U.M.'), (420, 'Valori di Riferimento')], size=8, bold=True, dy=14)
    p.c.line(40, p.y + 8, W - 40, p.y + 8)
    p.vuota(4)
    p.riga([(40, 'FARMACI')], size=10, bold=True, dy=14)
    p.riga([(40, 'Carbamazepina'), (250, '10,6 \u00b5g/ml'), (420, '4,0 - 12,0')], size=9, bold=True)
    p.riga([(40, 'Metodo: Immunochimico (KIMS)')], size=8)
    p.riga([(40, 'Materiale: SIERO')], size=8)
    p.vuota(16)
    p.riga([(40, '28-10-2026 15.30 SN=4918597, Emesso dall\'Ente Certificatore: InfoCamere Qualified Electronic Signature'), (420, 'Referto firmato da: GERINI LUCA')], size=7, dy=11)
    p.riga([(40, 'I risultati di questo referto sono interpretabili solo dal medico curante, che conosce il quadro clinico del paziente.')], size=7, dy=10)
    p.riga([(40, 'I dati personali sono trattati ai sensi del Regolamento UE 2016/679 (GDPR) e del D.Lgs. 196/2003, art.13.')], size=7, dy=10)
    p.riga([(40, 'Regolamento. Il laboratorio dove sono state ottenute le analisi e\' accreditato secondo la norma UNI EN ISO 15189.')], size=7, dy=10)
    p.c.setFont(FONT, 8)
    p.c.drawString(40, 30, 'Pagina 1 di 1')
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
    bianalisi(); cerba_rdi(); cerba_nuova_igea(); altro_farmaci(); non_referto()
    print('PDF di prova generati in', HERE)
    # Testo per i test senza poppler: stesso output di `pdftotext -layout` (form feed tra le pagine)
    import shutil, subprocess
    if shutil.which('pdftotext'):
        for f in ('bianalisi_urinocoltura', 'merge_kpc_rdi', 'nuova_igea_urinocoltura', 'altro_farmaci', 'lettera_offerta'):
            subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', os.path.join(HERE, f + '.pdf'), os.path.join(HERE, f + '.txt')], check=True)
        print('Testo estratto (.txt) aggiornato')
