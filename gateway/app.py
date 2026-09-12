from flask import Flask, render_template_string, request, redirect, session
import os

app = Flask(__name__)
app.secret_key = 'cyber-range-secret-key'

# صفحة تسجيل الدخول البسيطة
LOGIN_TEMPLATE = '''
<h2>Cyber Range Login</h2>
<form method="POST">
    <label>Username:</label><br>
    <input type="text" name="username" required><br><br>
    <label>Role (doctor / student):</label><br>
    <input type="text" name="role" required><br><br>
    <button type="submit">Login</button>
</form>
'''

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        role = request.form.get('role')
        session['username'] = username
        session['role'] = role
        
        if role == 'doctor':
            return redirect('/doctor')
        else:
            return redirect('/student')
            
    return render_template_string(LOGIN_TEMPLATE)

@app.route('/doctor')
def doctor_panel():
    if session.get('role') != 'doctor':
        return "Unauthorized", 403
    return "<h1>Doctor Panel: Upload Labs Here</h1>"

@app.route('/student')
def student_panel():
    if session.get('role') != 'student':
        return "Unauthorized", 403
    return "<h1>Student Panel: Labs View Only (No Search/No Escape)</h1>"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
    