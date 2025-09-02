// Load materials table on page load and update shell courses
document.addEventListener('DOMContentLoaded', function() {
    loadMaterialsTable();
    updateShellCourses();
    updateShellCA();
    
    // Add event listeners for auto-calculation
    document.getElementById('H').addEventListener('input', updateShellCourses);
    document.getElementById('plate_width_mm').addEventListener('input', updateShellCourses);
    document.getElementById('CA_shell_capacity').addEventListener('input', updateShellCA);
});

function updateShellCourses() {
    const H = parseFloat(document.getElementById('H').value) || 12;
    const plateWidth = parseFloat(document.getElementById('plate_width_mm').value) || 2000;
    const numCourses = Math.ceil((H * 1000) / plateWidth);
    document.getElementById('num_courses').value = numCourses;
}

function updateShellCA() {
    const caShellCapacity = parseFloat(document.getElementById('CA_shell_capacity').value) || 3;
    document.getElementById('CA_shell').value = caShellCapacity;
}

async function loadMaterialsTable() {
    try {
        const response = await fetch('/api/materials');
        const materials = await response.json();
        
        const tbody = document.getElementById('materials_tbody');
        tbody.innerHTML = '';
        
        Object.entries(materials).forEach(([grade, props]) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${grade}</td>
                <td>${props.yield_min}</td>
                <td>${props.tensile_min}</td>
                <td>${props.max_thickness}</td>
                <td>${props.S_allow}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Failed to load materials:', error);
    }
}


// Global variables for capacity table
let capacityData = [];
let totalCapacity = 0;
let currentPage = 1;
let rowsPerPage = 20;
let sortColumn = 0;
let sortDirection = 'asc';

function generateCapacityTableRows(data, totalCap) {
    return data.map((pt, index) => {
        const percentFull = (pt.capacity_kL / totalCap * 100).toFixed(1);
        const volumeAdded = index > 0 ? (pt.capacity_kL - data[index-1].capacity_kL).toFixed(3) : pt.capacity_kL.toFixed(3);
        
        return `
            <tr>
                <td>${pt.height_m.toFixed(2)}</td>
                <td>${pt.capacity_kL.toLocaleString('en-US', {minimumFractionDigits: 3, maximumFractionDigits: 3})}</td>
                <td>${percentFull}%</td>
                <td>${volumeAdded}</td>
            </tr>
        `;
    }).join('');
}

function updateCapacityTableDisplay() {
    const tbody = document.getElementById('capacity-tbody');
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const pageData = window.capacityData.slice(startIndex, endIndex);
    
    tbody.innerHTML = generateCapacityTableRows(pageData, window.totalCapacity);
    
    // Update pagination info
    const totalPages = Math.ceil(window.capacityData.length / rowsPerPage);
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prev-btn').disabled = currentPage === 1;
    document.getElementById('next-btn').disabled = currentPage === totalPages;
}

function changeCapacityPage(direction) {
    const totalPages = Math.ceil(window.capacityData.length / rowsPerPage);
    const newPage = currentPage + direction;
    
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        updateCapacityTableDisplay();
    }
}

function sortCapacityTable(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }
    
    window.capacityData.sort((a, b) => {
        let valueA = column === 0 ? a.height_m : a.capacity_kL;
        let valueB = column === 0 ? b.height_m : b.capacity_kL;
        
        if (sortDirection === 'asc') {
            return valueA - valueB;
        } else {
            return valueB - valueA;
        }
    });
    
    currentPage = 1;
    updateCapacityTableDisplay();
    
    // Update sort indicators
    document.querySelectorAll('.sortable i').forEach(icon => {
        icon.className = 'fas fa-sort';
    });
    
    const currentIcon = document.querySelectorAll('.sortable')[column].querySelector('i');
    currentIcon.className = sortDirection === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
}

function filterCapacityTable() {
    const searchValue = document.getElementById('height-search').value.toLowerCase();
    
    if (searchValue === '') {
        window.capacityData = [...window.originalCapacityData];
    } else {
        window.capacityData = window.originalCapacityData.filter(item => 
            item.height_m.toString().includes(searchValue) ||
            item.capacity_kL.toString().includes(searchValue)
        );
    }
    
    currentPage = 1;
    updateCapacityTableDisplay();
}

function exportCapacityTable() {
    const headers = ['Height (m)', 'Capacity (kL)', '% Full', 'Volume Added (kL)'];
    let csvContent = headers.join(',') + '\n';
    
    window.capacityData.forEach((pt, index) => {
        const percentFull = (pt.capacity_kL / window.totalCapacity * 100).toFixed(1);
        const volumeAdded = index > 0 ? (pt.capacity_kL - window.capacityData[index-1].capacity_kL).toFixed(3) : pt.capacity_kL.toFixed(3);
        
        csvContent += `${pt.height_m.toFixed(2)},${pt.capacity_kL.toFixed(3)},${percentFull},${volumeAdded}\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tank_capacity_curve.csv';
    a.click();
    window.URL.revokeObjectURL(url);
}

async function calculateCapacity() {
    // Convert pressures to bar for backend
    const internalPressure = parseFloat(document.getElementById('internal_pressure').value || 0);
    const internalUnit = document.getElementById('internal_pressure_unit').value;
    const externalPressure = parseFloat(document.getElementById('external_pressure').value || 0);
    const externalUnit = document.getElementById('external_pressure_unit').value;
    
    const inputs = {
        D: parseFloat(document.getElementById('D').value),
        H: parseFloat(document.getElementById('H').value),
        G: parseFloat(document.getElementById('G').value),
        internal_pressure: internalPressure,
        internal_pressure_unit: internalUnit,
        external_pressure: externalPressure,
        external_pressure_unit: externalUnit,
        operating_temperature_C: parseFloat(document.getElementById('operating_temperature_C').value || 20),
        CA_shell: parseFloat(document.getElementById('CA_shell_capacity').value || 3),
        CA_bottom: parseFloat(document.getElementById('CA_bottom').value || 3),
        CA_roof: parseFloat(document.getElementById('CA_roof').value || 3),
        CA_structure: parseFloat(document.getElementById('CA_structure').value || 3),
        CA_anchor_bolt: parseFloat(document.getElementById('CA_anchor_bolt').value || 3),
        CA_external: parseFloat(document.getElementById('CA_external').value || 3)
    };

    const resultsDiv = document.getElementById('capacity_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-capacity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            // Build capacity curve table with improved formatting
            const curveData = data.capacity_curve_100mm;
            
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Tank Capacity Results</h3>
                <div class="formula">${data.formula}</div>
                <div class="result-grid">
                    <div class="result-item"><span class="result-label">Internal Pressure:</span><span class="result-value">${data.internal_pressure_display}</span></div>
                    <div class="result-item"><span class="result-label">External Pressure:</span><span class="result-value">${data.external_pressure_display}</span></div>
                    <div class="result-item"><span class="result-label">Operating Temperature (°C):</span><span class="result-value">${data.operating_temperature_C}</span></div>
                    <div class="result-item"><span class="result-label">Total Capacity (Annex A):</span><span class="result-value">${data.capacity_kL_from_annex.toLocaleString()} kL (${data.capacity_m3_from_annex.toLocaleString()} m³)</span></div>
                    <div class="result-item"><span class="result-label">Total Capacity (Geometric):</span><span class="result-value">${data.capacity_kL_geometric.toLocaleString()} kL (${data.capacity_m3_geometric.toLocaleString()} m³)</span></div>
                    <div class="result-item"><span class="result-label">Working Capacity (90%):</span><span class="result-value">${data.working_capacity_kL.toLocaleString()} kL (${data.working_capacity_m3.toLocaleString()} m³)</span></div>
                    <div class="result-item"><span class="result-label">Free Board Volume:</span><span class="result-value">${data.freeboard_volume_kL.toLocaleString()} kL (${data.freeboard_volume_m3.toLocaleString()} m³)</span></div>
                    <div class="result-item"><span class="result-label">Free Board Height:</span><span class="result-value">${data.freeboard_height_m.toFixed(3)} m</span></div>
                </div>
                
                <div class="capacity-table-section">
                    <h4><i class="fas fa-table"></i> Capacity vs Filling Height (every 100 mm)</h4>
                    <div class="table-controls">
                        <div class="table-info">
                            <span>Total entries: ${curveData.length}</span>
                        </div>
                        <div class="table-search">
                            <input type="text" id="height-search" placeholder="Search height..." onkeyup="filterCapacityTable()">
                            <button onclick="exportCapacityTable()" class="export-btn"><i class="fas fa-download"></i> Export CSV</button>
                        </div>
                    </div>
                    <div class="table-wrapper">
                        <table class="capacity-table" id="capacity-table">
                            <thead>
                                <tr>
                                    <th onclick="sortCapacityTable(0)" class="sortable">Height (m) <i class="fas fa-sort"></i></th>
                                    <th onclick="sortCapacityTable(1)" class="sortable">Capacity (kL) <i class="fas fa-sort"></i></th>
                                    <th>% Full</th>
                                    <th>Volume Added (kL)</th>
                                </tr>
                            </thead>
                            <tbody id="capacity-tbody">
                                ${generateCapacityTableRows(curveData, data.capacity_kL_geometric)}
                            </tbody>
                        </table>
                    </div>
                    <div class="table-pagination">
                        <button onclick="changeCapacityPage(-1)" id="prev-btn"><i class="fas fa-chevron-left"></i> Previous</button>
                        <span id="page-info">Page 1 of ${Math.ceil(curveData.length / 20)}</span>
                        <button onclick="changeCapacityPage(1)" id="next-btn">Next <i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
            `;
            
            // Store data globally for table functions
            window.capacityData = [...curveData]; // Create a copy for filtering
            window.originalCapacityData = curveData; // Keep original for reset
            window.totalCapacity = data.capacity_kL_geometric;
            window.currentPage = 1;
            window.rowsPerPage = 20;
            
            // Store shell results for other calculations
            window._last_shell = data;
            
            // Initialize table
            setTimeout(() => updateCapacityTableDisplay(), 100);
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}


async function calculateShell() {
    const inputs = {
        D: parseFloat(document.getElementById('D').value),
        H: parseFloat(document.getElementById('H').value),
        G: parseFloat(document.getElementById('G').value),
        shell_material: document.getElementById('shell_material').value,
        joint_efficiency_E: parseFloat(document.getElementById('joint_efficiency_E').value),
        CA_shell: parseFloat(document.getElementById('CA_shell').value),
        CA_shell_from_capacity: parseFloat(document.getElementById('CA_shell_capacity')?.value || document.getElementById('CA_shell').value),
        plate_width_mm: parseFloat(document.getElementById('plate_width_mm').value),
        sd_MPa: document.getElementById('sd_MPa').value ? parseFloat(document.getElementById('sd_MPa').value) : null,
        st_MPa: document.getElementById('st_MPa').value ? parseFloat(document.getElementById('st_MPa').value) : null
    };

    const resultsDiv = document.getElementById('shell_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-shell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            // Nested table after joint efficiency
            const rows = data.nested_table.map(r => `
                <tr>
                    <td>${r.course}</td>
                    <td>${r.H_local_m}</td>
                    <td>${r.sd_MPa}</td>
                    <td>${r.st_MPa}</td>
                    <td>${r.td_mm}</td>
                    <td>${r.tt_mm}</td>
                    <td>${r.tr_mm}</td>
                </tr>
            `).join('');

            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Shell Thickness Results (API-650 Cl.5.6)</h3>
                <div class="result-item"><span class="result-label">Material:</span><span class="result-value">${data.material}</span></div>
                <div class="result-item"><span class="result-label">Joint Efficiency:</span><span class="result-value">${data.joint_efficiency}</span></div>
                <div class="result-item"><span class="result-label">Plate Width (mm):</span><span class="result-value">${data.plate_width_mm}</span></div>
                <div class="result-item"><span class="result-label">Number of Shell Courses (auto):</span><span class="result-value">${data.num_courses}</span></div>

                <h4>Per-Course Thickness Mapping</h4>
                <table class="results-table">
                    <thead>
                        <tr>
                            <th>Course</th>
                            <th>H_local (m)</th>
                            <th>sd (MPa)</th>
                            <th>st (MPa)</th>
                            <th>td (mm)</th>
                            <th>tt (mm)</th>
                            <th>tr (mm)</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>

                <div class="result-item">
                    <span class="result-label">Max Stress (bottom course) (MPa):</span>
                    <span class="result-value">${data.max_bottom_course_stress_MPa}</span>
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function calculateWind() {
    const inputs = {
        D: document.getElementById('D').value,
        H: document.getElementById('H').value,
        V: document.getElementById('V').value,
        Kz: document.getElementById('Kz').value,
        Kzt: document.getElementById('Kzt').value,
        Kd: document.getElementById('Kd').value,
        I: document.getElementById('I').value,
        Gf: document.getElementById('Gf').value,
        t_top: document.getElementById('t_top').value
    };

    const resultsDiv = document.getElementById('wind_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-wind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Wind Analysis Results (API-650 Cl.5.9)</h3>
                <div class="formula">
                    ${data.formula}<br>
                    Max Unstiffened Height: H1 = 2.5 × √(D × t_top / p)
                </div>
                <div class="result-item">
                    <span class="result-label">Wind Speed:</span>
                    <span class="result-value">${data.wind_speed_mph} mph</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Velocity Pressure:</span>
                    <span class="result-value">${data.velocity_pressure} psf</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Max Unstiffened Height:</span>
                    <span class="result-value">${data.max_unstiffened_height_H1_mm} mm</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Ring Area Required:</span>
                    <span class="result-value">${data.ring_area_required_mm2} mm²</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Stiffening Rings Needed:</span>
                    <span class="result-value">${data.stiffening_rings_needed ? 'YES' : 'NO'}</span>
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function calculateSeismic() {
    const inputs = {
        Ss: document.getElementById('Ss').value,
        S1: document.getElementById('S1').value,
        W_eff: document.getElementById('W_eff').value,
        R: document.getElementById('R').value,
        Ie: document.getElementById('Ie').value,
        H: document.getElementById('H').value
    };

    const resultsDiv = document.getElementById('seismic_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-seismic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Seismic Analysis Results (API-650 Annex E)</h3>
                <div class="formula">
                    ${data.formula}<br>
                    Overturning: M_o = Ci × W_eff × Hc
                </div>
                <div class="result-item">
                    <span class="result-label">Seismic Coefficient Cs:</span>
                    <span class="result-value">${data.seismic_coefficient}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Base Shear V:</span>
                    <span class="result-value">${data.base_shear.toLocaleString()} N</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Overturning Moment M_o:</span>
                    <span class="result-value">${data.overturning_moment.toLocaleString()} N⋅m</span>
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function calculateAccess() {
    const inputs = {
        stair_clear_width: document.getElementById('stair_clear_width').value,
        stair_angle_deg: document.getElementById('stair_angle_deg').value,
        handrail_height: document.getElementById('handrail_height').value,
        railing_post_spacing: document.getElementById('railing_post_spacing').value,
        tread_rise: document.getElementById('tread_rise').value,
        tread_run: document.getElementById('tread_run').value
    };

    const resultsDiv = document.getElementById('access_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Access Design Results (Tables 5.18 & 5.19)</h3>
                <div class="formula">
                    ${data.formula}
                </div>
                <div class="result-item">
                    <span class="result-label">All Requirements Passed:</span>
                    <span class="result-value">${data.requirements_passed ? 'YES' : 'NO'}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Clear Width Check:</span>
                    <span class="result-value">${data.individual_checks.clear_width_ok ? 'PASS' : 'FAIL'}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Angle Check (≤50°):</span>
                    <span class="result-value">${data.individual_checks.angle_ok ? 'PASS' : 'FAIL'}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Handrail Height Check:</span>
                    <span class="result-value">${data.individual_checks.handrail_height_ok ? 'PASS' : 'FAIL'}</span>
                </div>
                <div class="result-item">
                    <span class="result-label">Rise-Run Acceptable:</span>
                    <span class="result-value">${data.rise_run_acceptable ? 'YES' : 'NO'}</span>
                </div>
                ${data.recommended_rise_run ? `
                    <div class="result-item">
                        <span class="result-label">Recommended Rise/Run:</span>
                        <span class="result-value">${data.recommended_rise_run.rise}mm / ${data.recommended_rise_run.run}mm (${data.recommended_rise_run.angle}°)</span>
                    </div>
                ` : ''}
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function calculateRoof() {
    const inputs = {
        D: parseFloat(document.getElementById('D').value),
        live_load_kPa: parseFloat(document.getElementById('live_load_kPa').value),
        snow_load_kPa: parseFloat(document.getElementById('snow_load_kPa').value),
        CA_roof: parseFloat(document.getElementById('CA_roof')?.value || 3),
        roof_material: document.getElementById('roof_material').value
    };

    const resultsDiv = document.getElementById('roof_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-roof', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Roof Plate Thickness Results (API-650 Cl.5.10)</h3>
                <div class="formula">${data.formula}</div>
                <div class="result-grid">
                    <div class="result-item"><span class="result-label">Roof Type:</span><span class="result-value">${data.roof_type}</span></div>
                    <div class="result-item"><span class="result-label">Live Load:</span><span class="result-value">${data.live_load_kPa} kPa</span></div>
                    <div class="result-item"><span class="result-label">Snow Load:</span><span class="result-value">${data.snow_load_kPa} kPa</span></div>
                    <div class="result-item"><span class="result-label">Total Load:</span><span class="result-value">${data.total_load_kPa} kPa</span></div>
                    <div class="result-item"><span class="result-label">Required Thickness:</span><span class="result-value">${data.required_thickness_mm} mm</span></div>
                    <div class="result-item"><span class="result-label">Material:</span><span class="result-value">${data.material}</span></div>
                    <div class="result-item"><span class="result-label">CA Roof:</span><span class="result-value">${data.CA_roof_mm} mm</span></div>
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function calculateBottom() {
    const inputs = {
        D: parseFloat(document.getElementById('D').value),
        H: parseFloat(document.getElementById('H').value),
        G: parseFloat(document.getElementById('G').value),
        CA_bottom: parseFloat(document.getElementById('CA_bottom')?.value || 3),
        bottom_material: document.getElementById('bottom_material').value
    };

    const resultsDiv = document.getElementById('bottom_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-bottom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Bottom Plate Thickness Results</h3>
                <div class="result-grid">
                    <div class="result-item"><span class="result-label">Required Thickness:</span><span class="result-value">${data.required_thickness_mm} mm</span></div>
                    <div class="result-item"><span class="result-label">Material:</span><span class="result-value">${data.material}</span></div>
                    <div class="result-item"><span class="result-label">Allowable Stress:</span><span class="result-value">${data.S_allow_MPa} MPa</span></div>
                    <div class="result-item"><span class="result-label">CA Bottom:</span><span class="result-value">${data.CA_bottom_mm} mm</span></div>
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function calculateAnnular() {
    const inputs = {
        D: parseFloat(document.getElementById('D').value),
        H: parseFloat(document.getElementById('H').value),
        G: parseFloat(document.getElementById('G').value),
        shell_thickness_mm: window._last_shell?.nested_table?.map(c => c.tr_mm) || [10, 8, 6]
    };

    const resultsDiv = document.getElementById('annular_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-annular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Annular Plate Evaluation Results</h3>
                <div class="result-grid">
                    <div class="result-item"><span class="result-label">Annular Plate Required:</span><span class="result-value">${data.annular_required ? 'YES' : 'NO'}</span></div>
                    <div class="result-item"><span class="result-label">Tank Diameter:</span><span class="result-value">${data.tank_diameter_ft} ft</span></div>
                    <div class="result-item"><span class="result-label">Shell Weight:</span><span class="result-value">${data.shell_weight_kg.toLocaleString()} kg</span></div>
                    <div class="result-item"><span class="result-label">Liquid Weight:</span><span class="result-value">${data.liquid_weight_kg.toLocaleString()} kg</span></div>
                    ${data.annular_required ? `
                        <div class="result-item"><span class="result-label">Annular Thickness:</span><span class="result-value">${data.annular_thickness_mm} mm</span></div>
                        <div class="result-item"><span class="result-label">Annular Width:</span><span class="result-value">${data.annular_width_mm} mm</span></div>
                    ` : ''}
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function calculateAnchors() {
    const inputs = {
        D: parseFloat(document.getElementById('D').value),
        H: parseFloat(document.getElementById('H').value),
        wind_moment_Nm: parseFloat(document.getElementById('wind_moment_Nm').value),
        seismic_moment_Nm: parseFloat(document.getElementById('seismic_moment_Nm').value),
        dead_weight_N: parseFloat(document.getElementById('dead_weight_N').value)
    };

    const resultsDiv = document.getElementById('anchor_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/calculate-anchors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Anchor Chairs Calculation Results</h3>
                <div class="result-grid">
                    <div class="result-item"><span class="result-label">Anchor Chairs Required:</span><span class="result-value">${data.anchor_chairs_required ? 'YES' : 'NO'}</span></div>
                    <div class="result-item"><span class="result-label">Overturning Moment:</span><span class="result-value">${data.overturning_moment_Nm.toLocaleString()} N⋅m</span></div>
                    <div class="result-item"><span class="result-label">Restoring Moment:</span><span class="result-value">${data.restoring_moment_Nm.toLocaleString()} N⋅m</span></div>
                    ${data.anchor_chairs_required ? `
                        <div class="result-item"><span class="result-label">Uplift Force:</span><span class="result-value">${data.uplift_force_N.toLocaleString()} N</span></div>
                        <div class="result-item"><span class="result-label">Number of Chairs:</span><span class="result-value">${data.number_of_chairs}</span></div>
                        <div class="result-item"><span class="result-label">Chair Spacing:</span><span class="result-value">${data.chair_spacing_m} m</span></div>
                    ` : ''}
                </div>
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}

async function recommendMaterial() {
    const inputs = {
        temperature: document.getElementById('temperature').value,
        pressure: document.getElementById('pressure').value,
        thicknesses: [
            parseFloat(document.getElementById('thickness_shell').value),
            parseFloat(document.getElementById('thickness_roof').value),
            parseFloat(document.getElementById('thickness_bottom').value)
        ],
        region: document.getElementById('region').value
    };

    const resultsDiv = document.getElementById('material_results');
    resultsDiv.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Calculating...</div>';
    resultsDiv.classList.add('show');

    try {
        const response = await fetch('/api/recommend-material', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        });

        const data = await response.json();

        if (response.ok) {
            resultsDiv.innerHTML = `
                <h3><i class="fas fa-chart-line"></i> Material Recommendations (Tables 4.2 & 5.2)</h3>
                <div class="formula">
                    Based on controlling thickness: ${data.controlling_thickness}mm at ${data.temperature}°C
                </div>
                ${data.recommended_materials.map((material, i) => `
                    <div class="result-item">
                        <span class="result-label">${i + 1}. ${material.grade}:</span>
                        <span class="result-value">S_allow = ${material.S_allow} MPa, Yield = ${material.yield} MPa</span>
                    </div>
                    <div class="result-item">
                        <span class="result-label">Reason:</span>
                        <span class="result-value">${material.reason}</span>
                    </div>
                `).join('')}
            `;
        } else {
            resultsDiv.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<div class="error">Calculation failed: ${error.message}</div>`;
    }
}


// ===== Nozzles UI helpers =====
function addNozzleRow() {
    const tbody = document.getElementById('nozzle_tbody');
    const idx = tbody.children.length + 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" placeholder="NZ-${idx}"></td>
        <td>
            <select>
                <option value="shell">shell</option>
                <option value="roof">roof</option>
                <option value="bottom">bottom</option>
                <option value="manhole">manhole</option>
                <option value="cleanout">cleanout</option>
            </select>
        </td>
        <td><input type="text" placeholder="inlet/outlet/vent/drain"></td>
        <td><input type="number" step="0.01" value="1.0"></td>
        <td><input type="number" step="0.1" value="50"></td>
        <td><input type="number" step="0.01" value="1.0"></td>
        <td><input type="number" step="1" value="30"></td>
        <td><input type="number" step="0.1" placeholder="auto"></td>
        <td class="result"></td>
        <td class="result"></td>
        <td class="result"></td>
        <td class="result"></td>
        <td><button class="calc-btn secondary" onclick="this.closest('tr').remove()">Remove</button></td>
    `;
    tbody.appendChild(tr);
}

function clearNozzles() {
    document.getElementById('nozzle_tbody').innerHTML = '';
}

async function calculateNozzles() {
    const D = parseFloat(document.getElementById('D').value);
    const H = parseFloat(document.getElementById('H').value);
    const rows = Array.from(document.querySelectorAll('#nozzle_tbody tr'));
    const payload = rows.map(r => {
        const [tag, type, service, elev, flow, press, temp, vel] = Array.from(r.querySelectorAll('td input, td select')).map(e => e.value);
        return {
            tag, type, service,
            elevation_m: parseFloat(elev||0),
            required_flow_m3_h: parseFloat(flow||0),
            design_pressure_bar: parseFloat(press||0),
            design_temperature_C: parseFloat(temp||20),
            desired_velocity_m_s: vel ? parseFloat(vel) : null
        };
    });
    const body = { D, H, items: payload };

    const response = await fetch('/api/nozzles/select', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
        alert('Nozzle calculation error: ' + data.error);
        return;
    }
    // Render into table
    rows.forEach((r, i) => {
        const res = data.results[i];
        const tds = r.querySelectorAll('td.result');
        tds[0].innerText = res.selected_NPS_inch ?? '-';
        tds[1].innerText = res.selected_schedule ?? (res.schedule_hint || '-');
        tds[2].innerText = (res.velocity_m_s!=null ? res.velocity_m_s.toFixed(2) : '-');
        tds[3].innerText = (res.t_required_mm!=null ? res.t_required_mm.toFixed(2) : '-');
    });
}

async function evaluateAnnexP() {
    const payload = {
        D_tank_m: parseFloat(document.getElementById('D').value),
        shell_thickness_mm: (window._last_shell && window._last_shell.nested_table?.[0]?.tr_mm) || 10,
        nozzle_neck_OD_mm: 168, // default 6" OD
        reinforcement_type: 'shell',
        nozzle_elevation_m: 1.0,
        FR_N: parseFloat(document.getElementById('FR_N').value),
        ML_Nm: parseFloat(document.getElementById('ML_Nm').value),
        MC_Nm: parseFloat(document.getElementById('MC_Nm').value)
    };
    const resp = await fetch('/api/nozzles/annexP', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });
    const data = await resp.json();
    const div = document.getElementById('annexp_results');
    if (resp.ok) {
        div.innerHTML = `
            <div class="result-grid">
                <div class="result-item"><span class="result-label">Allowable FR (N):</span><span class="result-value">${data.allowable_FR_N.toFixed(1)}</span></div>
                <div class="result-item"><span class="result-label">Allowable ML (N·m):</span><span class="result-value">${data.allowable_ML_Nm.toFixed(1)}</span></div>
                <div class="result-item"><span class="result-label">Allowable MC (N·m):</span><span class="result-value">${data.allowable_MC_Nm.toFixed(1)}</span></div>
                <div class="result-item"><span class="result-label">Utilization:</span><span class="result-value">${(data.utilization_ratios*100).toFixed(1)}%</span></div>
                <div class="result-item"><span class="result-label">Result:</span><span class="result-value ${data.pass_fail ? 'ok' : 'bad'}">${data.pass_fail ? 'PASS' : 'FAIL'}</span></div>
            </div>
        `;
    } else {
        div.innerHTML = `<div class="error">${data.error || 'Annex P evaluation failed'}</div>`;
    }
}
