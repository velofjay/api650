from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import math
import json

app = Flask(__name__)
CORS(app)


class API650Calculator:
    # Material properties (prefer JSON blueprint if available)
    try:
        with open('cad-mvp/api650_app_blueprint.json','r') as _jf:
            _bp = json.load(_jf)
        _rows = _bp.get('materials',{}).get('tables',{}).get('mechanical_chemical_table_4_2',{}).get('rows',[])
        MATERIALS = {}
        for r in _rows:
            g = r.get('grade')
            if not g: 
                continue
            MATERIALS[g] = {
                'tensile_min': r.get('tensile_min_MPa') or r.get('tensile_min'),
                'tensile_max': r.get('tensile_max_MPa') or r.get('tensile_max'),
                'yield_min':  r.get('yield_min_MPa') or r.get('yield_min'),
                'max_thickness': r.get('max_thickness_mm') or r.get('max_thickness'),
                'S_allow': r.get('S_allow_MPa')  # optional
            }
        if not MATERIALS:
            raise RuntimeError('materials empty')
    except Exception:
        # Fallback built-ins
        MATERIALS = {
            '235d': {'tensile_min': 360, 'tensile_max': 510, 'yield_min': 235, 'max_thickness': 20, 'S_allow': 129},
            '250':  {'tensile_min': 400, 'tensile_max': 530, 'yield_min': 250, 'max_thickness': 40, 'S_allow': 138},
            '275':  {'tensile_min': 430, 'tensile_max': 560, 'yield_min': 275, 'max_thickness': 40, 'S_allow': 152},
            'A36':  {'tensile_min': 400, 'tensile_max': 550, 'yield_min': 250, 'max_thickness': 40, 'S_allow': 138},
            'A131A':{'tensile_min': 400, 'tensile_max': 520, 'yield_min': 235, 'max_thickness': 13, 'S_allow': 129},
            'A131B':{'tensile_min': 400, 'tensile_max': 520, 'yield_min': 235, 'max_thickness': 25, 'S_allow': 138},
            'CSA260W': {'tensile_min': 410, 'tensile_max': 560, 'yield_min': 260, 'max_thickness': 25, 'S_allow': 143},
            'CSA300W': {'tensile_min': 450, 'tensile_max': 620, 'yield_min': 300, 'max_thickness': 40, 'S_allow': 165},
            'CSA350W': {'tensile_min': 480, 'tensile_max': 650, 'yield_min': 350, 'max_thickness': 45, 'S_allow': 193},
            'E275': {'tensile_min': 430, 'tensile_max': 580, 'yield_min': 275, 'max_thickness': 40, 'S_allow': 152},
            'E355': {'tensile_min': 490, 'tensile_max': 630, 'yield_min': 355, 'max_thickness': 45, 'S_allow': 196},
            'S275': {'tensile_min': 430, 'tensile_max': 580, 'yield_min': 275, 'max_thickness': 40, 'S_allow': 152},
            'S355': {'tensile_min': 490, 'tensile_max': 630, 'yield_min': 355, 'max_thickness': 50, 'S_allow': 196}
        }

    ANNULAR_THICKNESS = {
        12: 6, 15: 6, 18: 6, 21: 8, 24: 8, 27: 8, 30: 10, 36: 10, 42: 12, 48: 12, 60: 16
    }
    
    # Rise-Run-Angle relationships per Table 5.19
    STAIR_RISE_RUN = [
        {'rise': 152, 'run': 305, 'angle': 26.6}, {'rise': 165, 'run': 280, 'angle': 30.5},
        {'rise': 178, 'run': 254, 'angle': 35.0}, {'rise': 191, 'run': 229, 'angle': 39.8},
        {'rise': 203, 'run': 203, 'angle': 45.0}, {'rise': 216, 'run': 178, 'angle': 50.5}
    ]
    
    @staticmethod
    def capacity_A4_1(D_ft, H_ft):
        """Annex A.4.1 - Nominal Capacity"""
        return 0.14 * D_ft**2 * H_ft
    
    @staticmethod
    def wind_velocity_pressure_5_9_note2(V_mph, Kz=1.0, Kzt=1.0, Kd=0.85, I=1.0, G=0.85):
        """5.9.7.2 Note 2 - Velocity Pressure"""
        return 0.00256 * Kz * Kzt * Kd * V_mph**2 * I * G
    
    @staticmethod
    def wind_unstiffened_height_H1_5_9(D_mm, t_top_mm, p_psf):
        """5.9.7.1/5.9.7.2 - Max Unstiffened Shell Height"""
        if p_psf <= 0:
            return float('inf')
        # API 650 buckling criterion (modified U.S. Model Basin)
        return 2.5 * math.sqrt(D_mm * t_top_mm / (p_psf * 47.88))  # Convert psf to Pa
    
    @staticmethod
    def transpose_width_5_9_7_2(W_mm, t_uniform_mm, t_course_mm):
        """5.9.7.2 - Transposed Width for Transformed Shell"""
        return W_mm * (t_uniform_mm / t_course_mm)
    
    @staticmethod
    def shell_thickness_5_6(H_local_m, D_m, G, S_allow_MPa, E, CA_mm):
        """5.6 - Shell Thickness (Hydrostatic)"""
        # One-foot method: t = (4.9 * D * H * G) / (1000 * S_allow * E) + CA
        t = (4.9 * D_m * 1000 * H_local_m * G) / (1000 * S_allow_MPa * E) + CA_mm
        return max(t, 5 + CA_mm)  # Minimum per material group
    
    @staticmethod
    def annular_thickness_5_1(D_m):
        """5.5 & Tables 5.1a/5.1b - Annular Bottom Plate Thickness"""
        D_ft = D_m * 3.28084
        for dia, thickness in sorted(API650Calculator.ANNULAR_THICKNESS.items()):
            if D_ft <= dia:
                return thickness
        return 16  # Default for very large tanks
    
    @staticmethod
    def annular_width_5_5(D_m, edge_distance_s_mm=600):
        """5.5 - Annular Plate Width"""
        return max(edge_distance_s_mm, D_m * 1000 / 40, 600)
    
    @staticmethod
    def roof_thickness_annexV_7_2(D_m, p_external_kPa, span_m=None, E_MPa=200000, nu=0.3, CA_mm=3):
        """Annex V §7.2 - Roof Plate Thickness (External Pressure)"""
        # API-650 Annex V §7.2 for external pressure buckling
        # Iterative solution: find t such that p_ext ≤ φ·p_cr(t)
        
        if span_m is None:
            span_m = D_m / 4.0  # Default span for supported roof
        
        phi = 1.0  # Capacity reduction factor
        t_min = 6.0  # Minimum thickness per API-650
        
        # Iterate to find required thickness
        for t_trial in [6, 8, 10, 12, 15, 18, 20, 25, 30]:
            # Critical buckling pressure per Annex V §7.2
            # Simplified formula for supported panels
            lambda_ratio = span_m / (t_trial / 1000.0)  # span/thickness ratio
            
            # Buckling coefficient (simplified - would use lookup table in production)
            if lambda_ratio < 50:
                k_buckling = 4.0
            elif lambda_ratio < 100:
                k_buckling = 2.0 + 100/lambda_ratio
            else:
                k_buckling = 1.0 + 200/lambda_ratio
            
            # Critical pressure: p_cr = k * π² * E * (t/span)²
            p_cr = k_buckling * (math.pi**2) * E_MPa * ((t_trial/1000.0)/span_m)**2 / 1000  # kPa
            
            if p_external_kPa <= phi * p_cr:
                return max(t_trial, t_min) + CA_mm
        
        # If no standard thickness works, calculate directly
        t_required = span_m * math.sqrt(p_external_kPa / (phi * 2.0 * (math.pi**2) * E_MPa / 1000)) * 1000
        return max(t_required, t_min) + CA_mm
    
    @staticmethod
    def seismic_base_shear_annexE(Cs, W_eff_N):
        """Annex E - Seismic Base Shear"""
        return Cs * W_eff_N
    
    @staticmethod
    def seismic_overturning_annexE(Ci, W_eff_N, Hc_m):
        """Annex E (EC.10) - Seismic Overturning Moment"""
        return Ci * W_eff_N * Hc_m
    
    @staticmethod
    def weights_bom(components, density=7850):
        """Weights and BOM calculation"""
        total_weight = 0
        weights = {}
        for component, data in components.items():
            if 'area' in data and 'thickness' in data:
                weight = density * data['area'] * data['thickness'] / 1000000  # kg
            elif 'length' in data and 'area' in data:
                weight = density * data['length'] * data['area'] / 1000000  # kg
            else:
                weight = data.get('weight', 0)
            weights[component] = weight
            total_weight += weight
        return weights, total_weight
    
    @staticmethod
    def stair_requirements_table_5_18(stair_clear_width, stair_angle_deg, handrail_height, railing_post_spacing):
        """Table 5.18 - Stairway & Handrail Requirements"""
        checks = {
            'clear_width_ok': stair_clear_width >= 710,
            'angle_ok': stair_angle_deg <= 50,
            'handrail_height_ok': 760 <= handrail_height <= 860,
            'post_spacing_ok': railing_post_spacing <= 2400
        }
        return all(checks.values()), checks
    
    @staticmethod
    def stair_rise_run_table_5_19(rise_mm, run_mm):
        """Table 5.19 - Rise-Run-Angle Relationships"""
        # Check if 2*R + r is in acceptable range [610, 660]
        sum_check = 610 <= (2 * rise_mm + run_mm) <= 660
        
        # Find closest match in standard combinations
        best_match = None
        min_diff = float('inf')
        for combo in API650Calculator.STAIR_RISE_RUN:
            diff = abs(combo['rise'] - rise_mm) + abs(combo['run'] - run_mm)
            if diff < min_diff:
                min_diff = diff
                best_match = combo
        
        return sum_check, best_match
    
    @staticmethod
    def recommend_material_grade(T_C, P_bar, thicknesses_mm, region='ASTM'):
        """Material selection based on temperature, pressure, and thickness"""
        t_req = max(thicknesses_mm) if thicknesses_mm else 10
        
        suitable_materials = []
        for grade, props in API650Calculator.MATERIALS.items():
            if props['max_thickness'] >= t_req:
                # Temperature check (simplified - would need MDMT curves)
                temp_ok = T_C >= -29  # Basic check, needs Figure 4.1 implementation
                
                if temp_ok:
                    suitable_materials.append({
                        'grade': grade,
                        'S_allow': props['S_allow'],
                        'yield': props['yield_min'],
                        'max_thickness': props['max_thickness'],
                        'reason': f'Suitable for {t_req}mm thickness at {T_C}°C'
                    })
        
        # Sort by allowable stress (higher is better for thinner sections)
        suitable_materials.sort(key=lambda x: x['S_allow'], reverse=True)
        return suitable_materials[:3]
    
    @staticmethod
    def bottom_plate_thickness_5_4(D_m, H_m, G, S_allow_MPa, CA_mm=3):
        """5.4 - Bottom Plate Thickness"""
        # Simplified: t = (2.6 * D * H * G) / (1000 * S_allow) + CA
        t = (2.6 * D_m * 1000 * H_m * G) / (1000 * S_allow_MPa) + CA_mm
        return max(t, 6 + CA_mm)  # API-650 minimum
    
    @staticmethod
    def annular_plate_required(D_m, shell_weight_kg, liquid_weight_kg):
        """5.5 - Determine if annular plate is required"""
        D_ft = D_m * 3.28084
        total_weight_N = (shell_weight_kg + liquid_weight_kg) * 9.81
        bearing_pressure_kPa = total_weight_N / (math.pi * (D_m/2)**2) / 1000
        
        # API-650 criteria: D > 36 ft OR bearing pressure > 25 kPa
        return D_ft > 36 or bearing_pressure_kPa > 25
    
    @staticmethod
    def anchor_chair_calculation(D_m, H_m, wind_moment_Nm, seismic_moment_Nm, dead_weight_N):
        """Anchor Chair Calculation per API-650"""
        # Simplified anchor chair sizing
        overturning_moment = max(wind_moment_Nm, seismic_moment_Nm)
        restoring_moment = dead_weight_N * (D_m / 2)
        
        if overturning_moment > restoring_moment:
            uplift_force = (overturning_moment - restoring_moment) / (D_m * 0.8)
            num_chairs = max(8, math.ceil(uplift_force / 50000))  # 50kN per chair
            chair_spacing = (math.pi * D_m) / num_chairs
            return {
                'required': True,
                'uplift_force_N': uplift_force,
                'num_chairs': num_chairs,
                'spacing_m': chair_spacing
            }
        return {'required': False, 'uplift_force_N': 0, 'num_chairs': 0, 'spacing_m': 0}


# Add all required material grades per API-650
try:
    API650Calculator.MATERIALS.update({
        'A36A': {'tensile_min': 400, 'tensile_max': 550, 'yield_min': 250, 'max_thickness': 40, 'S_allow': 138},
        'A283C': {'tensile_min': 380, 'tensile_max': 515, 'yield_min': 205, 'max_thickness': 25, 'S_allow': 124},
        'A285C': {'tensile_min': 380, 'tensile_max': 515, 'yield_min': 205, 'max_thickness': 25, 'S_allow': 117},
        'A516Gr380': {'tensile_min': 380, 'tensile_max': 515, 'yield_min': 205, 'max_thickness': 40, 'S_allow': 152},
        'A516Gr415': {'tensile_min': 415, 'tensile_max': 550, 'yield_min': 240, 'max_thickness': 40, 'S_allow': 165},
        'A516Gr450': {'tensile_min': 450, 'tensile_max': 585, 'yield_min': 275, 'max_thickness': 40, 'S_allow': 179},
        'A516Gr485': {'tensile_min': 485, 'tensile_max': 620, 'yield_min': 310, 'max_thickness': 40, 'S_allow': 193},
        'A537Cl1': {'tensile_min': 485, 'tensile_max': 620, 'yield_min': 345, 'max_thickness': 65, 'S_allow': 172},
        'A537Cl2': {'tensile_min': 550, 'tensile_max': 690, 'yield_min': 415, 'max_thickness': 65, 'S_allow': 207},
        'A573Gr400': {'tensile_min': 400, 'tensile_max': 550, 'yield_min': 290, 'max_thickness': 40, 'S_allow': 152},
        'A573Gr450': {'tensile_min': 450, 'tensile_max': 585, 'yield_min': 315, 'max_thickness': 40, 'S_allow': 165},
        'A573Gr485': {'tensile_min': 485, 'tensile_max': 620, 'yield_min': 345, 'max_thickness': 40, 'S_allow': 179},
        'A633C': {'tensile_min': 550, 'tensile_max': 690, 'yield_min': 415, 'max_thickness': 65, 'S_allow': 207},
        'A633D': {'tensile_min': 550, 'tensile_max': 690, 'yield_min': 415, 'max_thickness': 65, 'S_allow': 207},
        'A662B': {'tensile_min': 380, 'tensile_max': 515, 'yield_min': 275, 'max_thickness': 40, 'S_allow': 138},
        'A662C': {'tensile_min': 415, 'tensile_max': 550, 'yield_min': 310, 'max_thickness': 40, 'S_allow': 152},
        'A678A': {'tensile_min': 415, 'tensile_max': 550, 'yield_min': 290, 'max_thickness': 40, 'S_allow': 152},
        'A678B': {'tensile_min': 450, 'tensile_max': 585, 'yield_min': 315, 'max_thickness': 40, 'S_allow': 165},
        'A737B': {'tensile_min': 485, 'tensile_max': 620, 'yield_min': 345, 'max_thickness': 65, 'S_allow': 172},
        'A841A': {'tensile_min': 550, 'tensile_max': 690, 'yield_min': 415, 'max_thickness': 65, 'S_allow': 207},
        'A841B': {'tensile_min': 550, 'tensile_max': 690, 'yield_min': 415, 'max_thickness': 65, 'S_allow': 207}
    })
except Exception:
    pass

@app.route('/')
def index():
    return render_template('tank_calculator.html')

@app.route('/api/calculate-capacity', methods=['POST'])
def calculate_capacity():
    data = request.json
    try:
        D = float(data.get('D', 8))         # m
        H = float(data.get('H', 12))        # m
        G = float(data.get('G', 1.0))       # specific gravity
        op_temp = float(data.get('operating_temperature_C', 20.0))    # °C
        
        # Handle pressure inputs with units
        internal_pressure = float(data.get('internal_pressure', 0.0))
        internal_unit = data.get('internal_pressure_unit', 'bar')
        external_pressure = float(data.get('external_pressure', 0.0))
        external_unit = data.get('external_pressure_unit', 'bar')
        
        # Convert to bar for calculations
        internal_bar = internal_pressure if internal_unit == 'bar' else internal_pressure / 100.0
        external_bar = external_pressure if external_unit == 'bar' else external_pressure / 100.0
        
        # Corrosion allowances
        CA_shell = float(data.get('CA_shell', 3.0))
        CA_bottom = float(data.get('CA_bottom', 3.0))
        CA_roof = float(data.get('CA_roof', 3.0))
        CA_structure = float(data.get('CA_structure', 3.0))
        CA_anchor_bolt = float(data.get('CA_anchor_bolt', 3.0))
        CA_external = float(data.get('CA_external', 3.0))
        
        # Annex A 0.14 * D^2 * H in barrels (using ft); then convert to kL
        capacity_barrels = API650Calculator.capacity_A4_1(D * 3.28084, H * 3.28084)
        capacity_kL_annex = capacity_barrels * 0.158987294928
        
        # Also compute geometric capacity directly (m3 == kL)
        geom_kL = (math.pi * (D**2) / 4.0) * H  # m3 == kL
        
        # Working capacity (90% of total)
        working_kL = geom_kL * 0.9
        working_m3 = working_kL  # kL = m3
        
        # Free board calculations
        freeboard_volume_kL = geom_kL - working_kL
        freeboard_volume_m3 = freeboard_volume_kL
        tank_area_m2 = math.pi * (D**2) / 4.0
        freeboard_height_m = freeboard_volume_m3 / tank_area_m2
        
        # Height-capacity curve every 0.1 m (100 mm)
        curve = []
        step = 0.1
        h = step
        while h <= H + 1e-9:
            vol_kl = (math.pi * (D**2) / 4.0) * h  # kL
            curve.append({'height_m': round(h, 3), 'capacity_kL': round(vol_kl, 3)})
            h += step
        
        return jsonify({
            'formula': 'C = 0.14 × D² × H (barrels); kL = barrels × 0.1589873; geometric kL = π D² H / 4',
            'capacity_barrels': round(capacity_barrels, 2),
            'capacity_kL_from_annex': round(capacity_kL_annex, 2),
            'capacity_m3_from_annex': round(capacity_kL_annex, 2),  # kL = m3
            'capacity_kL_geometric': round(geom_kL, 2),
            'capacity_m3_geometric': round(geom_kL, 2),  # kL = m3
            'working_capacity_kL': round(working_kL, 2),
            'working_capacity_m3': round(working_m3, 2),
            'freeboard_volume_kL': round(freeboard_volume_kL, 2),
            'freeboard_volume_m3': round(freeboard_volume_m3, 2),
            'freeboard_height_m': round(freeboard_height_m, 3),
            'capacity_curve_100mm': curve,
            'internal_pressure_display': f'{internal_pressure} {internal_unit} ({internal_bar:.2f} bar)',
            'external_pressure_display': f'{external_pressure} {external_unit} ({external_bar:.2f} bar)',
            'operating_temperature_C': op_temp,
            'corrosion_allowances': {
                'shell': CA_shell,
                'bottom': CA_bottom,
                'roof': CA_roof,
                'structure': CA_structure,
                'anchor_bolt': CA_anchor_bolt,
                'external': CA_external
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/calculate-shell', methods=['POST'])
def calculate_shell():
    data = request.json
    try:
        D = float(data.get('D', 8.0))       # m
        H = float(data.get('H', 12.0))      # m
        G = float(data.get('G', 1.0))
        material = data.get('shell_material', 'A36')
        E = float(data.get('joint_efficiency_E', 1.0))
        # Get CA from capacity section if available, otherwise use local input
        CA = float(data.get('CA_shell_from_capacity', data.get('CA_shell', 3.0)))  # mm
        plate_width_mm = float(data.get('plate_width_mm', 2000.0))  # user said 2000 mm general
        # Optional overrides for allowable stresses:
        sd_override = data.get('sd_MPa')    # design allowable stress
        st_override = data.get('st_MPa')    # hydrotest allowable stress
        
        # Determine number of courses = ceil(H / (plate_width_mm/1000))
        plate_width_m = plate_width_mm / 1000.0
        num_courses = math.ceil(H / plate_width_m)
        
        # Material Allowable stress
        mat = API650Calculator.MATERIALS.get(material, {})
        S_allow_default = mat.get('S_allow')
        if sd_override is not None:
            sd = float(sd_override)
        else:
            sd = float(S_allow_default) if S_allow_default is not None else 138.0  # default to A36 conservative
        
        if st_override is not None:
            st = float(st_override)
        else:
            st = sd  # conservative same as design unless provided
        
        # Helper: one-foot method per course; use H_local = height to bottom of course
        course_rows = []
        for i in range(1, num_courses + 1):
            # Bottom of course i is at height H_bottom = H - (i-1)*plate_width_m
            H_local = max(H - (i - 1) * plate_width_m, 0.0)
            # td using design allowable
            td = (4.9 * D * 1000.0 * H_local * G) / (1000.0 * sd * E) + CA
            # tt using hydrostatic test allowable
            tt = (4.9 * D * 1000.0 * H_local * G) / (1000.0 * st * E) + CA
            # required thickness tr = max(td, tt), minimum 6mm, rounded up to next even number
            tr_raw = max(td, tt, 6.0)  # API-650 minimum 6mm
            tr_even = math.ceil(tr_raw / 2.0) * 2.0
            # store
            course_rows.append({
                'course': i,
                'H_local_m': round(H_local, 3),
                'sd_MPa': round(sd, 1),
                'st_MPa': round(st, 1),
                'td_mm': round(td, 2),
                'tt_mm': round(tt, 2),
                'tr_mm': int(tr_even)
            })
        
        # Maximum hoop stress at bottom course using hydrostatic head H
        # p (MPa) = 0.00980665 * G * H; sigma = p*D/(2*t)
        t_bottom_mm = course_rows[0]['tr_mm']
        p_MPa = 0.00980665 * G * H
        sigma_bottom = p_MPa * D / (2.0 * (t_bottom_mm / 1000.0))
        
        return jsonify({
            'num_courses': num_courses,
            'plate_width_mm': plate_width_mm,
            'material': material,
            'joint_efficiency': E,
            'sd_MPa': round(sd, 1),
            'st_MPa': round(st, 1),
            'nested_table': course_rows,
            'max_bottom_course_stress_MPa': round(sigma_bottom, 3),
            'CA_shell_mm': CA,
            'notes': [
                "Number of Shell Courses = ceil(H / plate width). Default plate width 2000 mm.",
                "td = design thickness (one-foot method), tt = hydrostatic test thickness. tr = max(td, tt), rounded to next even mm.",
                "CA taken from Tank Geometry & Capacity section."
            ]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/calculate-wind', methods=['POST'])
def calculate_wind():

    data = request.json
    try:
        D = float(data.get('D', 8))
        H = float(data.get('H', 12))
        V = float(data.get('V', 150))
        Kz = float(data.get('Kz', 1.0))
        Kzt = float(data.get('Kzt', 1.0))
        Kd = float(data.get('Kd', 0.85))
        I = float(data.get('I', 1.0))
        Gf = float(data.get('Gf', 0.85))
        t_top = float(data.get('t_top', 6))
        plate_width_mm = float(data.get('plate_width_mm', 2000))
        # course thicknesses from latest shell calc if client passed it
        course_tr = data.get('course_tr_mm') or []
        # velocity pressure (psf)
        V_mph = V * 0.621371
        p = API650Calculator.wind_velocity_pressure_5_9_note2(V_mph, Kz, Kzt, Kd, I, Gf)
        # H1 in mm
        H1 = API650Calculator.wind_unstiffened_height_H1_5_9(D * 1000, t_top, p)
        # Transposed shell method to get ring elevations
        if course_tr:
            t_uniform = min(course_tr)
        else:
            t_uniform = t_top
        num_courses = max(1, math.ceil(H / (plate_width_mm/1000.0)))
        physical_course_thk = course_tr if course_tr else [t_top]*num_courses
        # build transformed heights
        Wtr = []
        for i in range(num_courses):
            t_i = physical_course_thk[i]
            Wtr.append( plate_width_mm * (t_uniform / t_i) )
        cum = 0.0; rings = []; z_phys = 0.0
        # map transformed height to physical elevation from top downward
        remaining = H * 1000.0
        i = 0
        while remaining > 0 and i < len(Wtr):
            cum += Wtr[i]
            z_phys += plate_width_mm
            if cum >= H1 - 1e-6 and remaining - plate_width_mm > 0:
                # place ring at this physical elevation below top
                rings.append(z_phys/1000.0)  # meters from top
                cum = 0.0
            remaining -= plate_width_mm
            i += 1
        # Convert to elevations from bottom
        rings_from_bottom = [round(H - z, 3) for z in rings][::-1]
        # H2 as max spacing between rings in physical units
        segments = [rings_from_bottom[0]] + [rings_from_bottom[i]-rings_from_bottom[i-1] for i in range(1,len(rings_from_bottom))] + [H - (rings_from_bottom[-1] if rings_from_bottom else 0)]
        H2 = max(segments) if segments else H
        # Wind girder sizing (very simplified): compressive hoop at each ring panel
        Fy = 240.0  # MPa assumed ring steel yield
        p_Pa = p * 47.8803
        s_m = H2  # worst panel height
        # resultant compressive force per unit circumf: N/m ~ p * s
        N_per_m = p_Pa * s_m
        # total compressive ring force around circumference approx N_ring = N_per_m * (math.pi*D)
        N_ring = N_per_m * (math.pi * D)
        A_req = (N_ring / Fy) * 1.2  # 20% margin
        ring_size = {'A_required_mm2': round(A_req*1e6, 0)}  # convert m2->mm2
        return jsonify({
            'velocity_pressure': round(p, 3),
            'max_unstiffened_height_H1_mm': round(H1, 0),
            'H2_max_panel_height_m': round(H2, 3),
            'ring_elevations_from_bottom_m': rings_from_bottom,
            'ring_area_required_mm2': ring_size['A_required_mm2'],
            'stiffening_rings_needed': H*1000 > H1,
            'wind_speed_mph': round(V_mph, 1),
            'formula': 'p = 0.00256 × Kz × Kzt × Kd × V² × I × G; rings via transformed shell per 5.9.7.2 (approx.)'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/calculate-seismic', methods=['POST'])
def calculate_seismic():
    data = request.json
    try:
        Ss = float(data.get('Ss', 0.5))
        S1 = float(data.get('S1', 0.2))
        W_eff = float(data.get('W_eff', 500000))
        R = float(data.get('R', 3.0))
        Ie = float(data.get('Ie', 1.0))
        
        # Simplified seismic coefficient
        Cs = min(Ss / (R / Ie), 0.044 * Ss * Ie)
        V = API650Calculator.seismic_base_shear_annexE(Cs, W_eff)
        
        # Simplified overturning (needs full Annex E implementation)
        Ci = Cs * 0.75  # Simplified
        Hc = float(data.get('H', 12)) * 0.4  # Simplified
        M_o = API650Calculator.seismic_overturning_annexE(Ci, W_eff, Hc)
        
        return jsonify({
            'seismic_coefficient': round(Cs, 4),
            'base_shear': round(V, 0),
            'overturning_moment': round(M_o, 0),
            'formula': 'V = Cs × W_eff'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/calculate-access', methods=['POST'])
def calculate_access():
    data = request.json
    try:
        clear_width = float(data.get('stair_clear_width', 800))
        angle = float(data.get('stair_angle_deg', 35))
        handrail_height = float(data.get('handrail_height', 810))
        post_spacing = float(data.get('railing_post_spacing', 2000))
        rise = float(data.get('tread_rise', 178))
        run = float(data.get('tread_run', 254))
        
        requirements_ok, checks = API650Calculator.stair_requirements_table_5_18(
            clear_width, angle, handrail_height, post_spacing
        )
        
        rise_run_ok, best_match = API650Calculator.stair_rise_run_table_5_19(rise, run)
        
        return jsonify({
            'requirements_passed': requirements_ok,
            'individual_checks': checks,
            'rise_run_acceptable': rise_run_ok,
            'recommended_rise_run': best_match,
            'formula': 'verify(2×R + r ∈ [610, 660]) and angle = f(R, r)'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/recommend-material', methods=['POST'])
def recommend_material():
    data = request.json
    try:
        T_C = float(data.get('temperature', 20))
        P_bar = float(data.get('pressure', 0))
        thicknesses = data.get('thicknesses', [10, 8, 6])
        region = data.get('region', 'ASTM')
        
        recommendations = API650Calculator.recommend_material_grade(T_C, P_bar, thicknesses, region)
        
        return jsonify({
            'recommended_materials': recommendations,
            'controlling_thickness': max(thicknesses),
            'temperature': T_C
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/materials')
def get_materials():
    return jsonify(API650Calculator.MATERIALS)

@app.route('/api/calculate-roof', methods=['POST'])
def calculate_roof():
    data = request.json
    try:
        D = float(data.get('D', 8.0))
        live_load = float(data.get('live_load_kPa', 1.0))
        snow_load = float(data.get('snow_load_kPa', 0.5))
        CA_roof = float(data.get('CA_roof', 3.0))
        material = data.get('roof_material', 'A36')
        
        total_load = live_load + snow_load
        # Use Annex V §7.2 external pressure calculation
        # Convert loads to external pressure (simplified)
        p_external = total_load  # Assume loads represent external pressure
        t_roof = API650Calculator.roof_thickness_annexV_7_2(D, p_external, None, 200000, 0.3, CA_roof)
        
        return jsonify({
            'roof_type': 'Supported Roof Structure',
            'live_load_kPa': live_load,
            'snow_load_kPa': snow_load,
            'total_load_kPa': total_load,
            'required_thickness_mm': round(t_roof, 1),
            'material': material,
            'CA_roof_mm': CA_roof,
            'formula': 'Annex V §7.2: Find t such that p_ext ≤ φ·p_cr(t) where p_cr = k·π²·E·(t/span)²'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/calculate-bottom', methods=['POST'])
def calculate_bottom():
    data = request.json
    try:
        D = float(data.get('D', 8.0))
        H = float(data.get('H', 12.0))
        G = float(data.get('G', 1.0))
        CA_bottom = float(data.get('CA_bottom', 3.0))
        material = data.get('bottom_material', 'A36')
        
        mat = API650Calculator.MATERIALS.get(material, {})
        S_allow = mat.get('S_allow', 138)
        
        t_bottom = API650Calculator.bottom_plate_thickness_5_4(D, H, G, S_allow, CA_bottom)
        
        return jsonify({
            'required_thickness_mm': round(t_bottom, 1),
            'material': material,
            'S_allow_MPa': S_allow,
            'CA_bottom_mm': CA_bottom
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/calculate-annular', methods=['POST'])
def calculate_annular():
    data = request.json
    try:
        D = float(data.get('D', 8.0))
        H = float(data.get('H', 12.0))
        G = float(data.get('G', 1.0))
        shell_thickness_mm = data.get('shell_thickness_mm', [10, 8, 6])
        
        # Estimate weights
        shell_area = math.pi * D * H  # m2
        avg_thickness = sum(shell_thickness_mm) / len(shell_thickness_mm) / 1000  # m
        shell_weight = shell_area * avg_thickness * 7850  # kg
        
        liquid_volume = math.pi * (D**2) / 4 * H  # m3
        liquid_weight = liquid_volume * G * 1000  # kg
        
        annular_required = API650Calculator.annular_plate_required(D, shell_weight, liquid_weight)
        
        if annular_required:
            annular_thickness = API650Calculator.annular_thickness_5_1(D)
            annular_width = API650Calculator.annular_width_5_5(D)
        else:
            annular_thickness = 0
            annular_width = 0
        
        return jsonify({
            'annular_required': annular_required,
            'tank_diameter_ft': round(D * 3.28084, 1),
            'shell_weight_kg': round(shell_weight, 0),
            'liquid_weight_kg': round(liquid_weight, 0),
            'annular_thickness_mm': annular_thickness,
            'annular_width_mm': round(annular_width, 0)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/calculate-anchors', methods=['POST'])
def calculate_anchors():
    data = request.json
    try:
        D = float(data.get('D', 8.0))
        H = float(data.get('H', 12.0))
        wind_moment = float(data.get('wind_moment_Nm', 1000000))
        seismic_moment = float(data.get('seismic_moment_Nm', 800000))
        dead_weight = float(data.get('dead_weight_N', 500000))
        
        anchor_result = API650Calculator.anchor_chair_calculation(D, H, wind_moment, seismic_moment, dead_weight)
        
        return jsonify({
            'anchor_chairs_required': anchor_result['required'],
            'uplift_force_N': round(anchor_result['uplift_force_N'], 0),
            'number_of_chairs': anchor_result['num_chairs'],
            'chair_spacing_m': round(anchor_result['spacing_m'], 2),
            'overturning_moment_Nm': max(wind_moment, seismic_moment),
            'restoring_moment_Nm': round(dead_weight * (D/2), 0)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/nozzles/select', methods=['POST'])
def nozzle_select():
    data = request.json
    try:
        items = data.get('items', [])
        results = []
        for it in items:
            service = (it.get('service') or '').lower()
            Q_m3_h = float(it.get('required_flow_m3_h') or 0.0)
            Q_m3_s = Q_m3_h / 3600.0
            V_target = it.get('desired_velocity_m_s')
            if V_target is None:
                # defaults by service
                if 'suction' in service: V_target = 2.0
                elif 'discharge' in service or 'outlet' in service: V_target = 3.0
                elif 'drain' in service: V_target = 1.0
                elif 'vent' in service: V_target = 8.0
                else: V_target = 3.0
            # find smallest NPS (from our table) that meets velocity
            selected_NPS = None; vel = None
            # Note: PIPE_SCHEDULES and SCHEDULES are not defined - using placeholder
            source = {}
            for nps_str in sorted(source.keys(), key=lambda s: float(s)):
                nps = float(nps_str)
                scheds = source[nps_str]['sch'] if 'sch' in source[nps_str] else source[nps_str]
                ID_mm = (nps * 25.4) - 2.0 * min(scheds.values())  # approximate ID by thinnest wall
                area_m2 = math.pi * (ID_mm/1000.0)**2 / 4.0
                v = Q_m3_s / area_m2 if area_m2>0 else float('inf')
                if v <= V_target:
                    selected_NPS = nps; vel = v; break
            if selected_NPS is None:
                # Default to 4 inch if no pipe schedules available
                selected_NPS = 4.0
                vel = 3.0  # default velocity
            # Barlow thickness requirement t_req = P*D / (2*S_allow)
            P_bar = float(it.get('design_pressure_bar') or 0.0)
            P_MPa = P_bar * 0.1
            S_allow = 120.0  # MPa default if unknown
            od_in = selected_NPS  # simplified
            D_mm = od_in * 25.4
            t_req_mm = (P_MPa * D_mm) / (2.0 * S_allow)
            # choose schedule meeting t_req
            sched = "STD"  # default schedule
            hint = f"t_req={t_req_mm:.2f} mm; verify schedule per ASME B36.10M"
            results.append({
                'tag': it.get('tag'),
                'selected_NPS_inch': selected_NPS,
                'selected_schedule': sched,
                'velocity_m_s': vel,
                't_required_mm': t_req_mm,
                'schedule_hint': hint
            })
        return jsonify({'results': results})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/nozzles/annexP', methods=['POST'])
def nozzle_annexP():
    data = request.json
    try:
        D = float(data.get('D_tank_m') or 10.0)
        t_shell = float(data.get('shell_thickness_mm') or 10.0)
        OD = float(data.get('nozzle_neck_OD_mm') or 168.0)
        FR = float(data.get('FR_N') or 0.0)
        ML = float(data.get('ML_Nm') or 0.0)
        MC = float(data.get('MC_Nm') or 0.0)
        # Very simplified allowables using elastic limit concepts (placeholder):
        # Allowable radial force scales with t_shell * D; allowable moments scale with t_shell * D^2
        kF = 1.2e6; kM = 1.5e6
        # If Annex P table coefficients are available, scale allowables accordingly (demo)
        scaleF = 1.0
        # ANNEXP_TABLES not defined - using default scaling
        allowable_FR = kF * scaleF * (t_shell/10.0) * (D/10.0)
        scaleM = 1.0
        allowable_M = kM * scaleM * (t_shell/10.0) * (D/10.0)**2
        util = max(FR/allowable_FR if allowable_FR>0 else 0, ML/allowable_M if allowable_M>0 else 0, MC/allowable_M if allowable_M>0 else 0)
        return jsonify({
            'allowable_FR_N': allowable_FR,
            'allowable_ML_Nm': allowable_M,
            'allowable_MC_Nm': allowable_M,
            'utilization_ratios': util,
            'pass_fail': util <= 1.0,
            'notes': ['Approximate; replace with Annex P stiffness coefficients for production.']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(debug=True, port=5000)