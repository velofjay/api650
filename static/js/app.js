class ExcelUI {
    constructor() {
        this.currentSheet = null;
        this.excelData = null;
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('loadExcel').addEventListener('click', () => this.loadExcel());
        document.getElementById('sheetSelect').addEventListener('change', (e) => this.loadSheet(e.target.value));
        document.getElementById('calculateBtn').addEventListener('click', () => this.calculateFormula());
    }

    async loadExcel() {
        const loading = document.getElementById('loading');
        const content = document.getElementById('content');
        const sheetSelector = document.getElementById('sheetSelector');

        loading.style.display = 'block';
        content.style.display = 'none';

        try {
            const response = await fetch('/api/load-excel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                this.populateSheetSelector(data.sheets);
                sheetSelector.style.display = 'block';
                this.showMessage('Excel file loaded successfully!', 'success');
            } else {
                this.showMessage(data.error || 'Failed to load Excel file', 'error');
            }
        } catch (error) {
            this.showMessage('Error loading Excel file: ' + error.message, 'error');
        } finally {
            loading.style.display = 'none';
        }
    }

    populateSheetSelector(sheets) {
        const select = document.getElementById('sheetSelect');
        select.innerHTML = '<option value="">Choose a sheet...</option>';
        
        sheets.forEach(sheet => {
            const option = document.createElement('option');
            option.value = sheet;
            option.textContent = sheet;
            select.appendChild(option);
        });
    }

    async loadSheet(sheetName) {
        if (!sheetName) return;

        const loading = document.getElementById('loading');
        const content = document.getElementById('content');

        loading.style.display = 'block';

        try {
            const response = await fetch(`/api/sheet/${encodeURIComponent(sheetName)}`);
            const data = await response.json();

            if (response.ok) {
                this.currentSheet = sheetName;
                this.excelData = data;
                this.renderSheet(data);
                content.style.display = 'block';
            } else {
                this.showMessage(data.error || 'Failed to load sheet', 'error');
            }
        } catch (error) {
            this.showMessage('Error loading sheet: ' + error.message, 'error');
        } finally {
            loading.style.display = 'none';
        }
    }

    renderSheet(data) {
        this.renderSheetInfo(data.structure);
        this.renderSections(data.structure.sections);
        this.renderFormulas(data.formulas);
        this.renderDataGrid(data.data);
        this.setupCalculator(data.formulas);
    }

    renderSheetInfo(structure) {
        const infoDiv = document.getElementById('sheetInfo');
        infoDiv.innerHTML = `
            <h3><i class="fas fa-info-circle"></i> Sheet Information</h3>
            <div class="info-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                <div class="info-item">
                    <strong>Sheet:</strong> ${this.currentSheet}
                </div>
                <div class="info-item">
                    <strong>Rows:</strong> ${structure.rows}
                </div>
                <div class="info-item">
                    <strong>Columns:</strong> ${structure.cols}
                </div>
                <div class="info-item">
                    <strong>Formulas:</strong> ${structure.formulas_count}
                </div>
                <div class="info-item">
                    <strong>Sections:</strong> ${structure.sections.length}
                </div>
            </div>
        `;
    }

    renderSections(sections) {
        const container = document.getElementById('sectionsContainer');
        container.innerHTML = '<h3><i class="fas fa-layer-group"></i> Sections</h3>';

        if (sections.length === 0) {
            container.innerHTML += '<p>No sections identified in this sheet.</p>';
            return;
        }

        sections.forEach((section, index) => {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'section';
            sectionDiv.innerHTML = `
                <div class="section-header" onclick="this.parentElement.querySelector('.section-content').style.display = this.parentElement.querySelector('.section-content').style.display === 'none' ? 'block' : 'none'">
                    <span>${section.name}</span>
                    <i class="fas fa-chevron-down"></i>
                </div>
                <div class="section-content">
                    <div class="section-grid">
                        ${section.cells.slice(0, 10).map(cell => `
                            <div class="cell-item">
                                <div class="cell-label">${this.getCellReference(cell.row, cell.col)}</div>
                                <div class="cell-value">${this.formatCellValue(cell.value)}</div>
                            </div>
                        `).join('')}
                    </div>
                    ${section.cells.length > 10 ? `<p style="margin-top: 10px; color: #7f8c8d;">... and ${section.cells.length - 10} more cells</p>` : ''}
                </div>
            `;
            container.appendChild(sectionDiv);
        });
    }

    renderFormulas(formulas) {
        const panel = document.getElementById('formulasPanel');
        const formulasList = document.getElementById('formulasList');

        if (Object.keys(formulas).length === 0) {
            formulasList.innerHTML = '<p>No formulas found in this sheet.</p>';
            return;
        }

        formulasList.innerHTML = '';
        Object.entries(formulas).forEach(([cellRef, formula]) => {
            const formulaDiv = document.createElement('div');
            formulaDiv.className = 'formula-item';
            formulaDiv.innerHTML = `
                <div class="formula-ref">${cellRef}</div>
                <div class="formula-text">${formula.formula}</div>
                <div class="formula-value">Result: ${this.formatCellValue(formula.value)}</div>
            `;
            formulasList.appendChild(formulaDiv);
        });

        document.getElementById('calculatorPanel').style.display = 'block';
    }

    renderDataGrid(data) {
        const gridContainer = document.getElementById('gridContainer');
        
        if (!data || data.length === 0) {
            gridContainer.innerHTML = '<p>No data to display.</p>';
            return;
        }

        // Create table
        const table = document.createElement('table');
        table.className = 'data-table';

        // Create header
        const headerRow = document.createElement('tr');
        const maxCols = Math.max(...data.map(row => row.length));
        
        // Add column headers (A, B, C, etc.)
        headerRow.appendChild(document.createElement('th')); // Empty corner cell
        for (let i = 0; i < maxCols; i++) {
            const th = document.createElement('th');
            th.textContent = String.fromCharCode(65 + i);
            headerRow.appendChild(th);
        }
        table.appendChild(headerRow);

        // Add data rows
        data.slice(0, 50).forEach((row, rowIndex) => { // Limit to first 50 rows for performance
            const tr = document.createElement('tr');
            
            // Row number
            const rowHeader = document.createElement('th');
            rowHeader.textContent = rowIndex + 1;
            tr.appendChild(rowHeader);

            // Data cells
            for (let colIndex = 0; colIndex < maxCols; colIndex++) {
                const td = document.createElement('td');
                const cell = row[colIndex];
                if (cell) {
                    td.textContent = this.formatCellValue(cell.value);
                    if (cell.type === 6) { // Formula cell
                        td.style.backgroundColor = '#fff3cd';
                        td.title = 'Formula cell';
                    }
                }
                tr.appendChild(td);
            }
            table.appendChild(tr);
        });

        gridContainer.innerHTML = '';
        gridContainer.appendChild(table);

        if (data.length > 50) {
            const note = document.createElement('p');
            note.textContent = `Showing first 50 rows of ${data.length} total rows.`;
            note.style.marginTop = '10px';
            note.style.color = '#7f8c8d';
            gridContainer.appendChild(note);
        }
    }

    setupCalculator(formulas) {
        const calcInputs = document.getElementById('calcInputs');
        calcInputs.innerHTML = '';

        // Extract unique cell references from formulas
        const cellRefs = new Set();
        Object.values(formulas).forEach(formula => {
            const matches = formula.formula.match(/[A-Z]+\d+/g);
            if (matches) {
                matches.forEach(ref => cellRefs.add(ref));
            }
        });

        // Create input fields for each cell reference
        Array.from(cellRefs).slice(0, 10).forEach(cellRef => { // Limit to 10 inputs
            const inputDiv = document.createElement('div');
            inputDiv.className = 'calc-input';
            inputDiv.innerHTML = `
                <label for="input_${cellRef}">${cellRef}:</label>
                <input type="number" id="input_${cellRef}" placeholder="Enter value for ${cellRef}">
            `;
            calcInputs.appendChild(inputDiv);
        });

        if (cellRefs.size === 0) {
            calcInputs.innerHTML = '<p>No input cells identified for calculation.</p>';
        }
    }

    async calculateFormula() {
        const inputs = {};
        const inputElements = document.querySelectorAll('#calcInputs input');
        
        inputElements.forEach(input => {
            const cellRef = input.id.replace('input_', '');
            const value = parseFloat(input.value) || 0;
            inputs[cellRef] = value;
        });

        // For demo, calculate the first formula
        const firstFormula = Object.values(this.excelData.formulas)[0];
        if (!firstFormula) {
            this.showCalculationResult('No formulas available for calculation', true);
            return;
        }

        try {
            const response = await fetch('/api/calculate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    formula: firstFormula.formula,
                    inputs: inputs
                })
            });

            const data = await response.json();
            
            if (response.ok) {
                this.showCalculationResult(`Result: ${data.result}`, false);
            } else {
                this.showCalculationResult(data.error, true);
            }
        } catch (error) {
            this.showCalculationResult('Calculation error: ' + error.message, true);
        }
    }

    showCalculationResult(message, isError) {
        const resultDiv = document.getElementById('calcResult');
        resultDiv.textContent = message;
        resultDiv.className = 'calc-result' + (isError ? ' error' : '');
        resultDiv.style.display = 'block';
    }

    getCellReference(row, col) {
        return String.fromCharCode(65 + col) + (row + 1);
    }

    formatCellValue(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }
        if (typeof value === 'number') {
            return value.toLocaleString();
        }
        return String(value);
    }

    showMessage(message, type) {
        // Simple message display - you can enhance this with a proper notification system
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 5px;
            color: white;
            font-weight: 600;
            z-index: 1000;
            background: ${type === 'success' ? '#27ae60' : '#e74c3c'};
        `;
        messageDiv.textContent = message;
        document.body.appendChild(messageDiv);

        setTimeout(() => {
            document.body.removeChild(messageDiv);
        }, 5000);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new ExcelUI();
});