function initialize_knockout() {
    // load everything
    load_builder(function(builder) {
        load_model(function(model) {
            var old_model = escher.utils.clone(model);
            optimize_loop(builder, model);
            d3.select('#reset-button')
                .on('click', function() {
                    model = escher.utils.clone(old_model);
                    optimize_loop(builder, model);
                });
        });
    });
}


function load_builder(callback) {
    // load the Builder
    d3.json('E coli core.Core metabolism.json', function(e, data) {
        if (e) console.warn(e);
        d3.text('builder-embed-1.1.2.css', function(e, css) {
            if (e) console.warn(e);
            var options = { menu: 'all',
                            enable_editing: false,
                            fill_screen: true,
                            reaction_styles: ['abs', 'color', 'size', 'text'],
                            never_ask_before_quit: true };
            var b = escher.Builder(data, null, css, d3.select('#map_container'), options);
            callback(b);
        });
    });
}


function load_model(callback) {
    d3.json('E coli core.json', function(e, data) {
        if (e) console.warn(e);
        callback(data);
    });
}


function optimize_loop(builder, model) {
    var solve_and_display = function(m, knockouts) {
        var problem = build_glpk_problem(m);
        var result = optimize(problem);
        var ko_string = Object.keys(knockouts).map(function(s) { return 'Δ'+s; }).join(' '),
            nbs = String.fromCharCode(160); // non-breaking space
        if (ko_string.length > 0) ko_string += ': ';
        else ko_string = 'Click a reaction to knock it out. ';
        if (result.f < 1e-3) {
            builder.set_reaction_data(null);
            builder.map.set_status(ko_string + 'You killed E.' + nbs + 'coli!');
        } else { 
            builder.set_reaction_data(result.x);
            builder.map.set_status(ko_string + 'Growth' + nbs + 'rate:' + nbs +
                                   (result.f/1.791*100).toFixed(1) + '%');
        }
    };

    var knockouts = {};

    // set up and run
    model = set_carbon_source(model, 'EX_glc_e', 20);
    solve_and_display(model, knockouts);
    
    // initialize event listeners
    var sel = builder.selection;
    sel.selectAll('.reaction,.reaction-label')
        .style('cursor', 'pointer')
        .on('click', function(d) {
            if (!(d.bigg_id in knockouts))
                knockouts[d.bigg_id] = true;
            model = knock_out_reaction(model, d.bigg_id);
            solve_and_display(model, knockouts);
        });
}


function fill_array(len, val) {
    for (var i = 0, arr = new Array(len); i < len;)
        arr[i++] = val;
    return arr;
}


function fill_array_single(len, val, index_value, index) {
    for (var i = 0, arr = new Array(len); i < len;) {
        if (i == index)
            arr[i++] = index_value;
        else 
            arr[i++] = val;
    }
    return arr;
}


function knock_out_reaction(model, reaction_id) {
    for (var i = 0, l = model.reactions.length; i < l; i++) {
        if (model.reactions[i].id == reaction_id) {
            model.reactions[i].lower_bound = 0.0;
            model.reactions[i].upper_bound = 0.0;
            return model;
        }
    }
    throw new Error('Bad reaction ' + reaction_id);
}


function set_carbon_source(model, reaction_id, sur) {
    for (var i = 0, l = model.reactions.length; i < l; i++) {
        if (model.reactions[i].id == reaction_id) {
            model.reactions[i].lower_bound = -sur;
            return model;
        }
    }
    throw new Error('Bad carbon source ' + reaction_id);
}


function build_glpk_problem(model) {
    /** Build a GLPK LP for the model.

     Arguments
     ---------

     model: A COBRA JSON model.

     */
    var n_rows = model.metabolites.length,
        n_cols = model.reactions.length,
        ia = [], ja = [], ar = [],
        met_lookup = {};

    // initialize LP objective
    var lp = glp_create_prob();
    glp_set_prob_name(lp, 'knockout FBA');
    // maximize
    glp_set_obj_dir(lp, GLP_MAX);
    // set up rows and columns
    glp_add_rows(lp, n_rows);
    glp_add_cols(lp, n_cols);

    // metabolites
    model.metabolites.forEach(function(metabolite, i) {
        var row_ind = i + 1;
        glp_set_row_name(lp, row_ind, metabolite.id);
        glp_set_row_bnds(lp, row_ind, GLP_FX, 0.0, 0.0);
        // remember the indices of the metabolites
        met_lookup[metabolite.id] = row_ind;
    });

    // reactions
    var mat_ind = 1;
    model.reactions.forEach(function(reaction, i) {
        var col_ind = i + 1;

        glp_set_col_name(lp, col_ind, reaction.id);
        if (reaction.lower_bound == reaction.upper_bound)
            glp_set_col_bnds(lp, col_ind, GLP_FX, reaction.lower_bound, reaction.upper_bound);
        else
            glp_set_col_bnds(lp, col_ind, GLP_DB, reaction.lower_bound, reaction.upper_bound);
        glp_set_obj_coef(lp, col_ind, reaction.objective_coefficient);

        // S matrix values
        for (var met_id in reaction.metabolites) {
            ia[mat_ind] = met_lookup[met_id];
            ja[mat_ind] = col_ind;
            ar[mat_ind] = reaction.metabolites[met_id];
            mat_ind++;
        }
    });
    // Load the S matrix
    glp_load_matrix(lp, ia.length - 1, ia, ja, ar);
    
    return lp;
}


function optimize(problem) {
    var smcp = new SMCP({presolve: GLP_ON});
    glp_simplex(problem, smcp);
    // get the objective
    var f = glp_get_obj_val(problem);
    // get the primal
    var x = {};
    for (var i = 1; i <= glp_get_num_cols(problem); i++){
        x[glp_get_col_name(problem, i)] = glp_get_col_prim(problem, i);
    }
    return {f: f, x: x};
}