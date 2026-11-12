import "../styles/Register.css";

export function Register() {
  return (
    <div className="register">
      <h2>Register</h2>
      <form>
        <label>
          Email <input type="email" name="email" />
        </label>
        <label>
          Username <input type="text" name="username" />
        </label>
        <label>
          Password <input type="password" name="password" />
        </label>
        <button type="submit">Register</button>
      </form>
    </div>
  );
}
